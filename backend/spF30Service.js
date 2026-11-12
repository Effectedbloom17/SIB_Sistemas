/**
 * SP-F-30 · Programación de estudios médicos.
 * La plantilla externa solo se lee y se copia. El archivero vive en otro
 * Google Sheet, dentro de la carpeta Archivero, con una hoja por programación.
 * El nombre de cada hoja es la fecha en que se hizo la programación y las
 * siglas de la empresa (ej. 11-11-26 BIZ).
 */

const driveService = require('./driveService');

const CODIGO_FORMATO = 'SP-F-30';
const TEMPLATE_DRIVE_ID = '1FGyC1dUIKqtsfJ6I3iPtijtLtyCcG0qXbnSnbcPq4hk';
const TEMPLATE_SHEET_TITLE = 'Plantilla';
const CARPETA_ARCHIVERO_ID = '1yiuvk0l5cT0qSBg56VtnhV8Eo54FNVjc';
const CARPETA_FIRMADOS_ID = '1ZUDcM_Z6VfChLp9fDYDaV_H0M0c7layP';
const NOMBRE_ARCHIVO_DRIVE = 'SP-F-30 Programación de estudios médicos (sistema)';

const TIPOS_ESTUDIO = ['Espirometría', 'Audiometría', 'Laboratorios', 'Placas'];
const DATA_START_ROW = 10;
const MAX_FILAS = 40;
const MAX_PDF_BYTES = 15 * 1024 * 1024;

const TABLA_LISTA = new Map();

function errorHttp(mensaje, status = 400) {
    const error = new Error(mensaje);
    error.status = status;
    return error;
}

function texto(valor) {
    return String(valor ?? '').replace(/\s+/g, ' ').trim();
}

function fechaIso(valor) {
    if (!valor) return '';
    if (valor instanceof Date && !Number.isNaN(valor.getTime())) {
        const mes = String(valor.getMonth() + 1).padStart(2, '0');
        const dia = String(valor.getDate()).padStart(2, '0');
        return `${valor.getFullYear()}-${mes}-${dia}`;
    }
    const match = String(valor).trim().match(/^(\d{4}-\d{2}-\d{2})/);
    return match ? match[1] : '';
}

function fechaVisible(iso) {
    const match = fechaIso(iso).match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!match) return '';
    return `${match[3]}/${match[2]}/${match[1]}`;
}

function siglasEmpresa(nombre) {
    const limpio = String(nombre || '')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toUpperCase()
        .replace(/[^A-Z0-9\s]/g, ' ')
        .trim();
    if (!limpio) return '';
    const palabras = limpio.split(/\s+/).filter(Boolean);
    const stop = new Set(['DE', 'DEL', 'LA', 'LAS', 'LOS', 'Y', 'E', 'SA', 'CV', 'SRL', 'SC', 'S', 'RL', 'THE', 'AND']);
    const base = palabras.filter((p) => p.length > 1 && !stop.has(p));
    const usar = base.length ? base : palabras;
    const siglas = usar.map((p) => p[0]).join('').replace(/[^A-Z0-9]/g, '');
    if (siglas.length >= 3) return siglas.slice(0, 3);
    return (usar[0] || '').slice(0, 3);
}

function normalizarSiglas(valor, nombreEmpresa) {
    const manual = texto(valor).toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 12);
    if (manual.length >= 2) return manual;
    return siglasEmpresa(nombreEmpresa);
}

function nombreHojaProgramacion(fecha, siglas) {
    const iso = fechaIso(fecha);
    const marca = normalizarSiglas(siglas, '');
    if (!iso) {
        throw errorHttp('Indica la fecha en la que se hizo la programación.');
    }
    if (marca.length < 2) {
        throw errorHttp('Indica las siglas de la empresa (mínimo 2 letras).');
    }
    const partes = iso.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    return `${partes[3]}-${partes[2]}-${partes[1].slice(2)} ${marca}`;
}

function rangoHoja(titulo, a1) {
    return `'${String(titulo || '').replace(/'/g, "''")}'!${a1}`;
}

function normalizarTipoEstudio(valor) {
    const crudo = Array.isArray(valor) ? valor.join(',') : String(valor || '');
    const partes = crudo.split(',').map((parte) => texto(parte).toLowerCase()).filter(Boolean);
    return TIPOS_ESTUDIO.filter((tipo) => partes.includes(tipo.toLowerCase())).join(', ');
}

function sanitizarFilas(filas) {
    const lista = Array.isArray(filas) ? filas : [];
    return lista
        .map((fila) => ({
            dia: texto(fila?.dia).slice(0, 40),
            nombre: texto(fila?.nombre).slice(0, 200),
            areaPuesto: texto(fila?.areaPuesto || fila?.area_puesto).slice(0, 200),
            tipoEstudio: normalizarTipoEstudio(fila?.tipoEstudio || fila?.tipo_estudio),
            firma: ''
        }))
        .filter((fila) => fila.dia || fila.nombre || fila.areaPuesto || fila.tipoEstudio || fila.firma)
        .slice(0, MAX_FILAS);
}

function parseJson(valor) {
    if (!valor) return {};
    if (typeof valor === 'object') return valor;
    try {
        return JSON.parse(valor);
    } catch (_) {
        return {};
    }
}

function filaPublica(row) {
    const datos = parseJson(row.datos_json);
    const filas = sanitizarFilas(datos.filas);
    return {
        id: row.id,
        empresa_id: row.empresa_id,
        fecha_programacion: fechaIso(row.fecha_programacion),
        siglas: row.siglas || '',
        hoja_titulo: row.hoja_titulo || '',
        persona_acude: row.persona_acude || '',
        fecha_realizacion: fechaIso(row.fecha_realizacion),
        observaciones: texto(datos.observaciones || ''),
        filas,
        drive_file_id: row.drive_file_id || null,
        drive_url: row.drive_url || null,
        pdf_file_id: row.pdf_file_id || null,
        pdf_url: row.pdf_url || null,
        pdf_nombre: row.pdf_nombre || null,
        created_at: row.created_at,
        updated_at: row.updated_at
    };
}

async function asegurarTabla(pool, dbKey) {
    if (!pool) throw errorHttp('Base de médicos no disponible', 503);
    if (TABLA_LISTA.get(dbKey)) return TABLA_LISTA.get(dbKey);
    const promesa = pool.query(`
        CREATE TABLE IF NOT EXISTS programacion_estudios (
            id INT AUTO_INCREMENT PRIMARY KEY,
            empresa_id INT NULL,
            fecha_programacion DATE NULL,
            siglas VARCHAR(12) NULL,
            hoja_titulo VARCHAR(100) NULL,
            persona_acude VARCHAR(200) NULL,
            fecha_realizacion DATE NULL,
            datos_json LONGTEXT NULL,
            drive_file_id VARCHAR(128) NULL,
            drive_url VARCHAR(500) NULL,
            pdf_file_id VARCHAR(128) NULL,
            pdf_url VARCHAR(500) NULL,
            pdf_nombre VARCHAR(255) NULL,
            activo TINYINT(1) NOT NULL DEFAULT 1,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            INDEX idx_prog_estudios_empresa (empresa_id)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `).then(() => true);
    TABLA_LISTA.set(dbKey, promesa);
    try {
        await promesa;
    } catch (error) {
        TABLA_LISTA.delete(dbKey);
        throw error;
    }
}

function afirmarNoEsPlantilla(fileId) {
    if (String(fileId || '').trim() === TEMPLATE_DRIVE_ID) {
        throw errorHttp('El archivo de trabajo no puede ser la plantilla.', 500);
    }
}

async function resolverArchivoSistema() {
    const archivos = await driveService.listarArchivosCarpeta(CARPETA_ARCHIVERO_ID);
    const objetivo = NOMBRE_ARCHIVO_DRIVE.toLowerCase();
    const encontrado = (archivos || [])
        .filter((archivo) => {
            const id = String(archivo.id || '');
            const nombre = String(archivo.name || '').toLowerCase();
            return id && id !== TEMPLATE_DRIVE_ID && nombre.startsWith(objetivo);
        })
        .sort((a, b) => new Date(b.modifiedTime || 0) - new Date(a.modifiedTime || 0))[0];
    if (encontrado?.id) {
        afirmarNoEsPlantilla(encontrado.id);
        return encontrado;
    }
    const copia = await driveService.copiarGoogleSheetACarpeta(
        TEMPLATE_DRIVE_ID,
        NOMBRE_ARCHIVO_DRIVE,
        CARPETA_ARCHIVERO_ID
    );
    afirmarNoEsPlantilla(copia.id);
    return copia;
}

async function quitarHojaPlantillaSistema(spreadsheetId) {
    const hojas = await driveService.listarHojasGoogleSheet(spreadsheetId);
    const plantilla = hojas.find((titulo) => titulo.toLowerCase() === TEMPLATE_SHEET_TITLE.toLowerCase());
    const otras = hojas.filter((titulo) => titulo.toLowerCase() !== TEMPLATE_SHEET_TITLE.toLowerCase());
    if (!plantilla || !otras.length) return;
    await driveService.eliminarHojasGoogleSheet(spreadsheetId, [plantilla]);
}

async function asegurarHojaItem(spreadsheetId, tituloDeseado, tituloActual) {
    afirmarNoEsPlantilla(spreadsheetId);
    const hojas = await driveService.listarHojasGoogleSheet(spreadsheetId);
    const actual = texto(tituloActual);
    if (actual && hojas.includes(actual)) {
        if (actual === tituloDeseado) return actual;
        const renombrada = await driveService.renombrarHojaGoogleSheet(spreadsheetId, actual, tituloDeseado);
        return renombrada.title || tituloDeseado;
    }
    const copiada = await driveService.copiarHojaEntreSpreadsheets(
        TEMPLATE_DRIVE_ID,
        TEMPLATE_SHEET_TITLE,
        spreadsheetId,
        tituloDeseado
    );
    await quitarHojaPlantillaSistema(spreadsheetId);
    return copiada.title;
}

async function filaObservaciones(spreadsheetId, titulo) {
    const valores = await driveService.leerRangoGoogleSheet(spreadsheetId, rangoHoja(titulo, 'A1:A80'));
    const indice = (valores || []).findIndex((fila) => String(fila?.[0] || '').toLowerCase().includes('observacion'));
    return indice >= 0 ? indice + 1 : 0;
}

async function ajustarFilasDatos(spreadsheetId, titulo, cantidad) {
    const necesarias = Math.max(1, Math.min(MAX_FILAS, cantidad));
    const obsRow = await filaObservaciones(spreadsheetId, titulo);
    if (!obsRow || obsRow <= DATA_START_ROW) {
        throw errorHttp('La hoja no trae la fila de observaciones de la plantilla.');
    }
    const disponibles = obsRow - DATA_START_ROW - 1;
    if (disponibles === necesarias) return;
    const hojas = await driveService.obtenerMetadatosHojasGoogleSheet(spreadsheetId);
    const hoja = (hojas || []).find((item) => item.title === titulo);
    if (!hoja) throw errorHttp('No se encontró la hoja de la programación.');
    if (necesarias > disponibles) {
        await driveService.insertarFilasGoogleSheet(
            spreadsheetId,
            hoja.sheetId,
            DATA_START_ROW - 1 + disponibles,
            necesarias - disponibles,
            { inheritFromBefore: true }
        );
        return;
    }
    await driveService.eliminarFilasGoogleSheet(
        spreadsheetId,
        hoja.sheetId,
        DATA_START_ROW - 1 + necesarias,
        disponibles - necesarias
    );
}

async function escribirProgramacion(spreadsheetId, titulo, datos) {
    const filas = datos.filas.length ? datos.filas : [{ dia: '', nombre: '', areaPuesto: '', tipoEstudio: '', firma: '' }];
    await ajustarFilasDatos(spreadsheetId, titulo, filas.length);
    const obsRow = await filaObservaciones(spreadsheetId, titulo);
    if (!obsRow) throw errorHttp('No se pudo ubicar Observaciones después de ajustar la hoja.');

    const actualizaciones = [
        { range: rangoHoja(titulo, 'A5'), values: [[`Nombre de la empresa: ${datos.empresa}`]] },
        { range: rangoHoja(titulo, 'A6'), values: [[`Nombre de la persona que acude: ${datos.persona}`]] },
        { range: rangoHoja(titulo, 'A7'), values: [[`Fecha de realización de estudios: ${fechaVisible(datos.fechaRealizacion)}`]] },
        { range: rangoHoja(titulo, `A${obsRow + 1}`), values: [[datos.observaciones]] }
    ];
    filas.forEach((fila, indice) => {
        const row = DATA_START_ROW + indice;
        actualizaciones.push(
            { range: rangoHoja(titulo, `A${row}`), values: [[fila.dia]] },
            { range: rangoHoja(titulo, `B${row}`), values: [[fila.nombre]] },
            { range: rangoHoja(titulo, `E${row}`), values: [[fila.areaPuesto]] },
            { range: rangoHoja(titulo, `G${row}`), values: [[fila.tipoEstudio]] },
            { range: rangoHoja(titulo, `I${row}`), values: [['']] }
        );
    });
    await driveService.actualizarCeldasGoogleSheet(spreadsheetId, actualizaciones);
}

async function sincronizarEnDrive(datos, previo) {
    const tituloDeseado = nombreHojaProgramacion(datos.fechaProgramacion, datos.siglas);
    const archivo = await resolverArchivoSistema();
    let tituloFinal = await asegurarHojaItem(archivo.id, tituloDeseado, previo?.hoja_titulo);
    if (!await filaObservaciones(archivo.id, tituloFinal)) {
        const copiada = await driveService.copiarHojaEntreSpreadsheets(
            TEMPLATE_DRIVE_ID,
            TEMPLATE_SHEET_TITLE,
            archivo.id,
            tituloDeseado
        );
        if (tituloFinal !== copiada.title) {
            await driveService.eliminarHojasGoogleSheet(archivo.id, [tituloFinal]);
        }
        tituloFinal = copiada.title;
        await quitarHojaPlantillaSistema(archivo.id);
    }
    await escribirProgramacion(archivo.id, tituloFinal, datos);
    const hojas = await driveService.obtenerMetadatosHojasGoogleSheet(archivo.id);
    const hoja = (hojas || []).find((item) => item.title === tituloFinal);
    const gid = hoja?.sheetId != null ? hoja.sheetId : '';
    const editorUrl = `https://docs.google.com/spreadsheets/d/${archivo.id}/edit${gid !== '' ? `#gid=${gid}` : ''}`;
    return {
        driveFileId: archivo.id,
        driveUrl: editorUrl,
        hojaTitulo: tituloFinal
    };
}

function payloadDe(body, nombreEmpresa) {
    const empresa = texto(body?.nombre_empresa || body?.empresa || nombreEmpresa);
    const fechaProgramacion = fechaIso(body?.fecha_programacion || body?.fechaProgramacion);
    const siglas = normalizarSiglas(body?.siglas, empresa);
    if (!empresa) throw errorHttp('Selecciona la empresa.');
    if (!fechaProgramacion) throw errorHttp('Indica la fecha en la que se hizo la programación.');
    if (siglas.length < 2) throw errorHttp('Indica las siglas de la empresa.');
    return {
        empresa,
        empresaId: Number(body?.empresa_id || body?.empresaId) || null,
        fechaProgramacion,
        siglas,
        persona: texto(body?.persona_acude || body?.personaAcude).slice(0, 200),
        fechaRealizacion: fechaIso(body?.fecha_realizacion || body?.fechaRealizacion),
        observaciones: texto(body?.observaciones).slice(0, 2000),
        filas: sanitizarFilas(body?.filas)
    };
}

async function guardarRegistro(pool, id, datos, drive) {
    const json = JSON.stringify({
        observaciones: datos.observaciones,
        filas: datos.filas
    });
    const valores = [
        datos.empresaId,
        datos.fechaProgramacion,
        datos.siglas,
        drive.hojaTitulo,
        datos.persona || null,
        datos.fechaRealizacion || null,
        json,
        drive.driveFileId,
        drive.driveUrl
    ];
    if (id) {
        await pool.query(
            `UPDATE programacion_estudios
             SET empresa_id = ?, fecha_programacion = ?, siglas = ?, hoja_titulo = ?,
                 persona_acude = ?, fecha_realizacion = ?, datos_json = ?,
                 drive_file_id = ?, drive_url = ?
             WHERE id = ? AND activo = 1`,
            [...valores, id]
        );
        return id;
    }
    const [result] = await pool.query(
        `INSERT INTO programacion_estudios
            (empresa_id, fecha_programacion, siglas, hoja_titulo, persona_acude,
             fecha_realizacion, datos_json, drive_file_id, drive_url)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        valores
    );
    return result.insertId;
}

async function obtenerPorId(pool, id) {
    const [rows] = await pool.query(
        'SELECT * FROM programacion_estudios WHERE id = ? AND activo = 1',
        [id]
    );
    return rows[0] || null;
}

async function guardar(pool, body, nombreEmpresa, id) {
    const datos = payloadDe(body, nombreEmpresa);
    if (!datos.empresaId) throw errorHttp('Selecciona la empresa.');
    const previo = id ? await obtenerPorId(pool, id) : null;
    if (id && !previo) throw errorHttp('No se encontró la programación.', 404);
    const drive = await sincronizarEnDrive(datos, previo);
    const guardadoId = await guardarRegistro(pool, id || null, datos, drive);
    const row = await obtenerPorId(pool, guardadoId);
    return filaPublica(row);
}

async function subirPdfFirmado(pool, id, body) {
    const row = await obtenerPorId(pool, id);
    if (!row) throw errorHttp('No se encontró la programación.', 404);
    const crudo = String(body?.pdf_base64 || body?.pdfBase64 || '').trim();
    if (!crudo) throw errorHttp('No se recibió el PDF.');
    const buffer = Buffer.from(crudo, 'base64');
    if (!buffer.length) throw errorHttp('El PDF está vacío.');
    if (buffer.length > MAX_PDF_BYTES) throw errorHttp('El PDF supera 15 MB.');
    const publica = filaPublica(row);
    const base = (publica.hoja_titulo || `${CODIGO_FORMATO}`).replace(/[<>:"/\\|?*]/g, '_');
    const nombre = `${CODIGO_FORMATO} ${base}.pdf`;
    const subido = await driveService.subirArchivo(buffer, nombre, 'application/pdf', CARPETA_FIRMADOS_ID);
    if (row.pdf_file_id && row.pdf_file_id !== subido.id) {
        try {
            await driveService.eliminarArchivo(row.pdf_file_id);
        } catch (error) {
            console.warn('[SP-F-30] No se pudo quitar el PDF firmado anterior:', error.message);
        }
    }
    await pool.query(
        `UPDATE programacion_estudios
         SET pdf_file_id = ?, pdf_url = ?, pdf_nombre = ?
         WHERE id = ?`,
        [subido.id, subido.webViewLink || null, subido.name || nombre, id]
    );
    const actualizado = await obtenerPorId(pool, id);
    return filaPublica(actualizado);
}

module.exports = {
    CODIGO_FORMATO,
    TEMPLATE_DRIVE_ID,
    CARPETA_ARCHIVERO_ID,
    CARPETA_FIRMADOS_ID,
    asegurarTabla,
    siglasEmpresa,
    nombreHojaProgramacion,
    filaPublica,
    guardar,
    obtenerPorId,
    subirPdfFirmado
};
