/**
 * BIZNAGA R&T - Generador de DC-3 (Constancia de Habilidades Laborales STPS)
 *
 * Genera archivos DC-3 en Excel a partir de la plantilla oficial,
 * rellenando datos del trabajador, empresa, curso e instructor.
 */

const ExcelJS = require('exceljs');
const path = require('path');
const v8 = require('v8');

// Plantilla DC-3 base (formato oficial STPS)
const PLANTILLA_PATH = path.join(__dirname, 'plantilla-dc3-stps.xlsx');

// Mapeo área temática del sistema → código STPS para DC-3
const AREAS_TEMATICAS_STPS = {
    1: '6000 SEGURIDAD',                         // Seguridad
    2: '6000 SEGURIDAD',                         // Higiene y Seguridad en el Trabajo
    3: '3000 DESARROLLO HUMANO',                 // Salud y Bienestar
    4: '5000 NORMATIVIDAD',                      // Medio Ambiente
    5: '1000 ADMINISTRACION Y GESTION EMPRESARIAL', // Productividad y Gerenciales
    6: '6000 SEGURIDAD',                         // Conducción de Vehículos
    7: '9000 OTRAS'                              // Áreas Diversas
};

// Ocupación específica del CNO según área
const OCUPACION_CNO = {
    1: '11 - DESARROLLO Y EXTENSIÓN DEL CONOCIMIENTO',
    2: '11 - DESARROLLO Y EXTENSIÓN DEL CONOCIMIENTO',
    3: '11 - DESARROLLO Y EXTENSIÓN DEL CONOCIMIENTO',
    4: '11 - DESARROLLO Y EXTENSIÓN DEL CONOCIMIENTO',
    5: '11 - DESARROLLO Y EXTENSIÓN DEL CONOCIMIENTO',
    6: '83 - CONDUCTORES DE TRANSPORTE Y DE MAQUINARIA MOVIL',
    7: '11 - DESARROLLO Y EXTENSIÓN DEL CONOCIMIENTO'
};
const OCUPACION_CNO_DEFAULT = '11 - DESARROLLO Y EXTENSIÓN DEL CONOCIMIENTO';

const RFC_EMPRESA_BIZNAGA = 'BRT1702204Z5';

function normalizarRfcEmpresa(valor) {
    return String(valor || '').replace(/[^a-zA-Z0-9]/g, '').toUpperCase();
}

function esEmpresaBiznaga(datos = {}) {
    const rfc = normalizarRfcEmpresa(datos.rfc_empresa || datos.rfc || '');
    if (rfc === RFC_EMPRESA_BIZNAGA) return true;

    const nombre = String(datos.nombre_empresa || datos.razon_social || '')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toUpperCase();
    return nombre.includes('BIZNAGA RISK AND TECH');
}

function construirNombreTrabajador(datos) {
    const nombre = String(datos.nombre || '').trim();
    const apellidoPaterno = String(datos.apellido_paterno || '').trim();
    const apellidoMaterno = String(datos.apellido_materno || '').trim();
    const nombreCompleto = String(datos.nombre_trabajador || '').replace(/\s+/g, ' ').trim();

    // El resto del sistema (pase de lista y constancias) ya usa:
    // apellido paterno + apellido materno + nombre(s).
    // Reordenar las últimas dos palabras convertía "GÁLVEZ TEJEDA ADRIÁN" en "TEJEDA ADRIÁN GÁLVEZ".
    if (apellidoPaterno || apellidoMaterno) {
        return [apellidoPaterno, apellidoMaterno, nombre].filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();
    }

    return nombreCompleto || nombre;
}

function resolverOcupacionEspecifica(datos = {}) {
    if (datos.usar_ocupacion_generica === true) {
        return OCUPACION_CNO_DEFAULT;
    }

    const puestoTrabajador = String(datos.puesto_trabajador || '').trim();
    if (puestoTrabajador) {
        return puestoTrabajador.toUpperCase();
    }

    return OCUPACION_CNO_DEFAULT;
}

/**
 * Generar un DC-3 individual en buffer Excel
 *
 * @param {object} datos - Datos para rellenar el DC-3
 * @param {string} datos.nombre_trabajador - Nombre completo del trabajador (APELLIDOS Y NOMBRE)
 * @param {string} [datos.nombre] - Nombre(s) del trabajador
 * @param {string} [datos.apellido_paterno] - Apellido paterno del trabajador
 * @param {string} [datos.apellido_materno] - Apellido materno del trabajador
 * @param {string} datos.curp - CURP del trabajador
 * @param {string} datos.nombre_empresa - Razón social de la empresa
 * @param {string} datos.rfc_empresa - RFC con homoclave
 * @param {string} datos.nombre_curso - Nombre del curso/taller
 * @param {number} datos.horas - Duración en horas
 * @param {Date|string} datos.fecha_inicio - Fecha inicio del curso
 * @param {Date|string} datos.fecha_fin - Fecha fin del curso
 * @param {number} datos.area_id - ID del área temática del sistema
 * @param {string} datos.instructor_nombre - Nombre completo del instructor
 * @param {string} datos.instructor_rfc - RFC del instructor (si se tiene)
 * @param {string} datos.agente_capacitador - Nombre del agente capacitador
 * @param {string} [datos.puesto_trabajador] - Puesto del trabajador
 * @param {boolean} [datos.usar_ocupacion_generica] - Si es true, usa la ocupación genérica CNO (modo anterior)
 * @param {Buffer|null} [datos.instructor_firma_buffer] - Buffer de la imagen de firma del instructor
 * @param {string|null} [datos.instructor_firma_ext] - Extensión de la imagen ('jpeg' | 'png')
 * @param {Buffer|null} [datos.empresa_logo_buffer] - Buffer de la imagen del logo de la empresa
 * @param {string|null} [datos.empresa_logo_ext] - Extensión de la imagen ('jpeg' | 'png')
 * @param {string} [datos.folio_dc3] - Folio del DC-3 (ej: B-DC3-26-001)
 * @returns {Promise<Buffer>} - Buffer del archivo Excel generado
 */
async function generarDC3(datos) {
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.readFile(PLANTILLA_PATH);

    const ws = workbook.worksheets[0]; // Primera hoja: "DC-3 "

    // ═══ ELIMINAR HOJAS EXTRA (solo mantener la primera) ═══
    while (workbook.worksheets.length > 1) {
        workbook.removeWorksheet(workbook.worksheets[workbook.worksheets.length - 1].id);
    }

    // ═══ ELIMINAR FILAS EXTRA después de la 43 (solo mostrar el anverso DC-3) ═══
    const totalRows = ws.rowCount;
    for (let r = totalRows; r > 43; r--) {
        const row = ws.getRow(r);
        for (let c = 1; c <= 33; c++) {
            const cell = row.getCell(c);
            cell.value = null;
            cell.style = {};
        }
        row.height = 0;
        row.hidden = true;
    }

    // ═══ ELIMINAR COLUMNAS EXTRA después de AA (col 27) ═══
    for (let c = 28; c <= 33; c++) {
        const col = ws.getColumn(c);
        col.width = 0;
        col.hidden = true;
        for (let r = 1; r <= 43; r++) {
            const cell = ws.getRow(r).getCell(c);
            cell.value = null;
            cell.style = {};
        }
    }

    // ═══ USAR LAS ALTURAS ORIGINALES DE LA PLANTILLA (idéntico al PDF) ═══
    // Estas son las alturas exactas del formato DC-3 oficial STPS
    const rowHeights = {
        1: 15,     // Logo BIZNAGA (~20px objetivo; ExcelJS usa puntos)
        2: 22.6,   // FORMATO DC-3
        3: 21.1,   // CONSTANCIA DE HABILIDADES LABORALES
        4: 12.9,   // Separador
        5: 18,     // DATOS DEL TRABAJADOR (header negro)
        6: 14.95,  // Label "Nombre..."
        7: 30,     // Valor: nombre del trabajador
        8: 20.25,  // Label "Clave única..." / "Ocupación específica..."
        9: 26.15,  // CURP + Ocupación
        10: 18.7,  // Separador (entre secciones)
        11: 18,    // DATOS DE LA EMPRESA (header negro)
        12: 14.95, // Label "Nombre o razón social..."
        13: 21.1,  // Valor: nombre empresa
        14: 12.75, // Label "Registro Federal..."
        15: 20.05, // Valor: RFC
        16: 20.05, // Separador (entre secciones)
        17: 18,    // DATOS DEL PROGRAMA... (header negro)
        18: 14.95, // Label "Nombre del curso"
        19: 22.5,  // Valor: nombre del curso (~30px objetivo)
        20: 24.8,  // Labels duración + periodo
        21: 18,    // Valores: horas + dígitos fechas
        22: 17.35, // Label "Área temática..."
        23: 29.25, // Valor: área temática
        24: 17.35, // Label "Agente capacitador..."
        25: 29.25, // Valor: agente capacitador
        26: 9,     // Separador antes de texto legal
        27: 45,    // Texto legal ("Los datos se asientan...")
        28: 17.35, // Encabezado firma (vacío con bordes)
        29: 41.3,  // Área de firma (instructor, patrón, representante)
        30: 30,    // Continuación firma + nombre
        31: 14.95, // "Nombre y firma" labels
        32: 12.9,  // Separador
        33: 17.35, // INSTRUCCIONES + folio
        34: 17.35, // Instrucción 1
        35: 12.9,  // Instrucción 2
        36: 14.95, // Nota 1/
        37: 12.9,  // Nota 1/ (áreas temáticas)
        38: 12.9,  // Nota 3/
        39: 12.9,  // Nota 4/
        40: 12.9,  // Continuación nota 4
        41: 12.9,  // Nota 5/
        42: 12.9,  // DC-3
        43: 12.9   // ANVERSO
    };
    for (const [row, height] of Object.entries(rowHeights)) {
        ws.getRow(parseInt(row)).height = height;
    }

    // ═══ OCULTAR CUADRÍCULA ═══
    ws.views = [{ showGridLines: false }];

    // ═══ CONFIGURAR PÁGINA: 1 sola hoja, ajustada ═══
    ws.pageSetup = {
        fitToPage: true,
        fitToWidth: 1,
        fitToHeight: 1,
        orientation: 'portrait',
        paperSize: 1, // Letter
        horizontalCentered: true,
        verticalCentered: false,
        showGridLines: false,
        showRowColHeaders: false,
        printArea: 'A1:AA43',
        margins: {
            left: 0.5,
            right: 0.5,
            top: 0.75,
            bottom: 0.75,
            header: 0.3,
            footer: 0.3
        }
    };

    // ═══ ELIMINAR FONDO VERDE de la pestaña ═══
    ws.properties.tabColor = undefined;

    // Colocar la leyenda final en dos celdas separadas para evitar desplazamientos al exportar.
    ws.getCell('AA42').value = 'DC-3';
    ws.getCell('AA42').font = { name: 'Arial', size: 8 };
    ws.getCell('AA42').alignment = { horizontal: 'right', vertical: 'middle', wrapText: true };
    ws.getCell('AA43').value = 'ANVERSO';
    ws.getCell('AA43').font = { name: 'Arial', size: 8 };
    // Para ANVERSO usar desbordamiento (sin ajuste) y evitar que el texto baje de línea.
    ws.getCell('AA43').alignment = { horizontal: 'right', vertical: 'middle', wrapText: false };

    // ═══ LOGO DE LA EMPRESA (esquina superior derecha) ═══
    // Se coloca cerca del encabezado "FORMATO DC-3 CONSTANCIA..."
    // Excepción: BIZNAGA RISK AND TECH ya tiene su logo a la izquierda en la plantilla.
    if (!esEmpresaBiznaga(datos) && datos.empresa_logo_buffer && datos.empresa_logo_ext) {
        try {
            const empresaLogoImageId = workbook.addImage({
                buffer: datos.empresa_logo_buffer,
                extension: datos.empresa_logo_ext
            });

            // Mantener margen derecho visible y dejar el logo un poco más a la derecha.
            ws.addImage(empresaLogoImageId, {
                tl: { col: 22.35, row: 1.13 },
                ext: { width: 112, height: 54 }
            });
        } catch (imgErr) {
            console.warn('[WARN] dc3Service: No se pudo insertar logo de empresa:', imgErr.message);
        }
    }

    // ═══ ELIMINAR TODOS LOS FILLS problemáticos (tema/indexed que causan fondo verde) ═══
    // ExcelJS comparte estilos internamente → hay que resetear style completo + reasignar
    const whiteFill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFFFFF' } };
    for (let r = 1; r <= 43; r++) {
        const row = ws.getRow(r);
        for (let c = 1; c <= 27; c++) {
            const cell = row.getCell(c);
            if (cell.fill && cell.fill.fgColor && cell.fill.fgColor.theme === 0) {
                // Guardar propiedades que queremos conservar
                const border = cell.border ? JSON.parse(JSON.stringify(cell.border)) : undefined;
                const font = cell.font ? JSON.parse(JSON.stringify(cell.font)) : undefined;
                const alignment = cell.alignment ? JSON.parse(JSON.stringify(cell.alignment)) : undefined;
                const value = cell.value;
                // Resetear estilo completo y reasignar con fill blanco ARGB (sin theme)
                cell.style = {};
                cell.fill = whiteFill;
                if (border) cell.border = border;
                if (font) cell.font = font;
                if (alignment) cell.alignment = alignment;
                cell.value = value;
            }
        }
    }

    // ═══ DATOS DEL TRABAJADOR ═══

    // Fila 7: Nombre del trabajador (A7:AA7 merged)
    const cellNombre = ws.getCell('A7');
    cellNombre.value = construirNombreTrabajador(datos).toUpperCase();
    cellNombre.font = { name: 'Arial', size: 11, bold: true };
    cellNombre.alignment = { horizontal: 'center', vertical: 'middle' };

    // Fila 9: CURP (A9:R9 merged)
    const cellCurp = ws.getCell('A9');
    cellCurp.value = (datos.curp || '').toUpperCase();
    cellCurp.font = { name: 'Arial', size: 11, bold: true };
    cellCurp.alignment = { horizontal: 'left', vertical: 'middle' };

    // Fila 9: Ocupación específica (S9:AA9 merged + shrinkToFit para ajustar al ancho)
    const areaId = datos.area_id || 1;
    if (!ws.getCell('S9').isMerged) {
        ws.mergeCells('S9:AA9');
    }
    const cellOcupacion = ws.getCell('S9');
    cellOcupacion.value = resolverOcupacionEspecifica(datos);
    cellOcupacion.font = { name: 'Arial', size: 11, bold: true };
    cellOcupacion.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };

    // ═══ DATOS DE LA EMPRESA ═══

    // Fila 13: Nombre o razón social (A13:AA13 merged)
    const cellEmpresa = ws.getCell('A13');
    cellEmpresa.value = (datos.nombre_empresa || '').toUpperCase();
    cellEmpresa.font = { name: 'Arial', size: 11, bold: true };
    cellEmpresa.alignment = { horizontal: 'left', vertical: 'middle' };

    // Fila 15: RFC con homoclave (A15:AA15 merged)
    const cellRFC = ws.getCell('A15');
    cellRFC.value = (datos.rfc_empresa || '').toUpperCase();
    cellRFC.font = { name: 'Arial', size: 11, bold: true };
    cellRFC.alignment = { horizontal: 'left', vertical: 'middle' };

    // ═══ DATOS DEL PROGRAMA DE CAPACITACIÓN ═══

    // Fila 19: Nombre del curso (A19:AA19 merged)
    const cellCurso = ws.getCell('A19');
    cellCurso.value = (datos.nombre_curso || '').toUpperCase();
    cellCurso.font = { name: 'Arial', size: 11, bold: true };
    cellCurso.alignment = { horizontal: 'left', vertical: 'middle' };

    // Fila 21: Duración en horas (A21:G21 merged)
    const cellHoras = ws.getCell('A21');
    cellHoras.value = `${parseInt(datos.horas, 10) || 0} HORAS`;
    cellHoras.font = { name: 'Arial', size: 11, bold: true };
    cellHoras.alignment = { horizontal: 'center', vertical: 'middle' };

    // Fila 21: Periodo de ejecución - Fechas en celdas individuales
    // Si no hay fecha_fin o es inválida, usar fecha_inicio (curso de un solo día/horas)
    const fi = new Date(datos.fecha_inicio);
    const ffRaw = datos.fecha_fin ? new Date(datos.fecha_fin) : null;
    const ff = (ffRaw && !isNaN(ffRaw.getTime())) ? ffRaw : fi;

    const fiYear = fi.getFullYear().toString();
    const fiMonth = (fi.getMonth() + 1).toString().padStart(2, '0');
    const fiDay = fi.getDate().toString().padStart(2, '0');
    const ffYear = ff.getFullYear().toString();
    const ffMonth = (ff.getMonth() + 1).toString().padStart(2, '0');
    const ffDay = ff.getDate().toString().padStart(2, '0');

    const dateCellFont = { name: 'Arial', size: 10, bold: true };
    const dateCellAlign = { horizontal: 'center', vertical: 'middle' };

    // Fecha inicio: K21=año[0], L21=año[1], M21=año[2], N21=año[3], O21=mes[0], P21=mes[1], Q21=día[0], R21=día[1]
    const fechaInicioCols = ['K', 'L', 'M', 'N', 'O', 'P', 'Q', 'R'];
    const fechaInicioVals = [fiYear[0], fiYear[1], fiYear[2], fiYear[3], fiMonth[0], fiMonth[1], fiDay[0], fiDay[1]];
    fechaInicioCols.forEach((col, i) => {
        const cell = ws.getCell(`${col}21`);
        cell.value = parseInt(fechaInicioVals[i]);
        cell.font = dateCellFont;
        cell.alignment = dateCellAlign;
    });

    // Fecha fin: T21=año[0], U21=año[1], V21=año[2], W21=año[3], X21=mes[0], Y21=mes[1], Z21=día[0], AA21=día[1]
    const fechaFinCols = ['T', 'U', 'V', 'W', 'X', 'Y', 'Z', 'AA'];
    const fechaFinVals = [ffYear[0], ffYear[1], ffYear[2], ffYear[3], ffMonth[0], ffMonth[1], ffDay[0], ffDay[1]];
    fechaFinCols.forEach((col, i) => {
        const cell = ws.getCell(`${col}21`);
        cell.value = parseInt(fechaFinVals[i]);
        cell.font = dateCellFont;
        cell.alignment = dateCellAlign;
    });

    // Fila 23: Área temática del curso (A23:AA23 merged)
    const cellArea = ws.getCell('A23');
    cellArea.value = AREAS_TEMATICAS_STPS[areaId] || AREAS_TEMATICAS_STPS[7];
    cellArea.font = { name: 'Arial', size: 11, bold: true };
    cellArea.alignment = { horizontal: 'left', vertical: 'middle' };

    // Fila 25: Agente capacitador (A25:AA25 merged)
    const cellAgente = ws.getCell('A25');
    const agenteNombre = (datos.agente_capacitador || 'BIZNAGA RISK AND TECH S DE R.L DE C.V.').toUpperCase();
    cellAgente.value = agenteNombre + '       BRT-170220-4Z5-0013';
    cellAgente.font = { name: 'Arial', size: 11, bold: true };
    cellAgente.alignment = { horizontal: 'left', vertical: 'middle' };

    // ═══ FIRMAS ═══
    // En el PDF original: B29:F30 está mergeado y contiene:
    //   - Título "Instructor o tutor" arriba
    //   - Firma (imagen) en medio 
    //   - Nombre del instructor abajo
    // Fila 31 tiene "Nombre y firma"

    const cellInstructor = ws.getCell('B29');
    const instructorNombre = (datos.instructor_nombre || '').toUpperCase();
    const instructorRfc = (datos.instructor_rfc || '').toUpperCase();
    const instructorTexto = instructorRfc
        ? `${instructorNombre}\n${instructorRfc}`
        : instructorNombre;

    // Mostrar siempre el título arriba + espacio para firma + nombre del instructor abajo
    cellInstructor.value = datos.instructor_firma_buffer && datos.instructor_firma_ext
        ? `Instructor o tutor\n\n\n\n${instructorTexto}`
        : `Instructor o tutor\n\n${instructorTexto}`;
    cellInstructor.font = { name: 'Arial', size: 9 };
    cellInstructor.alignment = { horizontal: 'center', vertical: 'top', wrapText: true };

    // Insertar la imagen de la firma del instructor si está disponible.
    // La imagen se posiciona flotando sobre el área de firma (fila 29-30, columnas B-F).
    // ExcelJS soporta JPEG y PNG; WebP no es compatible y se omite.
    if (datos.instructor_firma_buffer && datos.instructor_firma_ext) {
        try {
            const imageId = workbook.addImage({
                buffer: datos.instructor_firma_buffer,
                extension: datos.instructor_firma_ext
            });
            // tl: top-left en coordenadas 0-based (fila 28 = Excel fila 29, col 1 = columna B)
            // Firma posicionada debajo del título y un poco más arriba para no encimarse con el nombre
            ws.addImage(imageId, {
                tl: { col: 1.3, row: 28.25 },
                ext: { width: 150, height: 40 }
            });
        } catch (imgErr) {
            console.warn('[WARN] dc3Service: No se pudo insertar imagen de firma:', imgErr.message);
        }
    }

    // ═══ FOLIO DC-3 (fila 33, lado derecho, debajo de la línea recta) ═══
    if (datos.folio_dc3) {
        // Deshacer merge completo de A33:AA33 y re-merge solo A33:V33 para INSTRUCCIONES
        try { ws.unMergeCells('A33:AA33'); } catch (_) { }
        try { ws.mergeCells('A33:V33'); } catch (_) { }
        const cellInstrucciones = ws.getCell('A33');
        cellInstrucciones.value = 'INSTRUCCIONES';
        cellInstrucciones.font = { name: 'Arial', size: 10, bold: true };
        cellInstrucciones.alignment = { horizontal: 'left', vertical: 'middle' };

        try { ws.mergeCells('W33:AA33'); } catch (_) { }
        const cellFolio = ws.getCell('W33');
        cellFolio.value = datos.folio_dc3;
        cellFolio.font = { name: 'Arial', size: 9, bold: true };
        cellFolio.alignment = { horizontal: 'right', vertical: 'middle' };
    }

    // Refuerzo de bordes para evitar recorte en el cuadro de INSTRUCCIONES al exportar PDF.
    reforzarBordesCriticosDC3(ws);

    // Generar buffer
    const buffer = await workbook.xlsx.writeBuffer();
    return Buffer.from(buffer);
}

/**
 * Generar DC-3 en lote para múltiples participantes
 *
 * @param {object} cursoInfo - Datos del curso programado (de v_cursos_programados)
 * @param {number} areaId - ID del área temática
 * @param {Array<object>} participantes - Lista con nombre_completo, curp, puesto
 * @param {object} driveService - Módulo driveService para subir archivos
 * @param {string} carpetaDestinoId - ID de carpeta en Drive
 * @param {Function} [onProgress] - Callback (completados, total)
 * @param {Buffer|null} [firmaBuffer] - Buffer de la firma del instructor (opcional)
 * @param {string|null} [firmaExt] - Extensión de la firma ('jpeg' | 'png')
 * @returns {Promise<{exitosos: number, fallidos: number}>}
 */
async function generarDC3Lote(cursoInfo, areaId, participantes, driveService, carpetaDestinoId, onProgress, firmaBuffer = null, firmaExt = null) {
    let exitosos = 0;
    let fallidos = 0;
    const pdfIds = [];

    for (let i = 0; i < participantes.length; i++) {
        const p = participantes[i];
        try {
            const buffer = await generarDC3({
                nombre_trabajador: p.nombre_completo,
                nombre: p.nombre || '',
                apellido_paterno: p.apellido_paterno || '',
                apellido_materno: p.apellido_materno || '',
                curp: p.curp,
                nombre_empresa: cursoInfo.nombre_empresa,
                rfc_empresa: cursoInfo.empresa_rfc,
                nombre_curso: cursoInfo.nombre_curso,
                horas: cursoInfo.horas_informe || cursoInfo.curso_horas,
                fecha_inicio: cursoInfo.fecha_inicio,
                fecha_fin: cursoInfo.fecha_fin,
                area_id: areaId,
                instructor_nombre: cursoInfo.instructor_nombre,
                instructor_rfc: cursoInfo.instructor_rfc || '',
                agente_capacitador: 'BIZNAGA RISK AND TECH S DE R.L DE C.V.',
                puesto_trabajador: p.puesto || '',
                instructor_firma_buffer: firmaBuffer,
                instructor_firma_ext: firmaExt
            });

            const nombreArchivo = `DC3_${(p.nombre_completo || 'participante').replace(/[^a-zA-Z0-9áéíóúñÁÉÍÓÚÑ ]/g, '_')}.xlsx`;

            // Upload directo rápido (sin búsqueda de duplicados)
            const response = await driveService.subirArchivo(buffer, nombreArchivo, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', carpetaDestinoId);
            if (response && response.id) pdfIds.push(response.id);
            exitosos++;
        } catch (error) {
            console.error(`[ERROR] DC-3 para ${p.nombre_completo}: ${error.message}`);
            fallidos++;
        }

        if (onProgress) onProgress(i + 1, participantes.length);
    }

    return { exitosos, fallidos, total: participantes.length };
}

function sanitizarNombreHojaExcel(nombre, fallback = 'DC3') {
    // Excel limita el nombre de hoja a 31 chars y prohíbe: : \\ / ? * [ ]
    const limpio = String(nombre || '')
        .replace(/[\\/:*?\[\]]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
    return (limpio || fallback).slice(0, 31);
}

function nombreHojaUnico(base, usados) {
    let candidato = sanitizarNombreHojaExcel(base);
    if (!usados.has(candidato)) {
        usados.add(candidato);
        return candidato;
    }

    let idx = 2;
    while (idx < 1000) {
        const sufijo = ` (${idx})`;
        const truncado = candidato.slice(0, Math.max(1, 31 - sufijo.length));
        const intento = `${truncado}${sufijo}`;
        if (!usados.has(intento)) {
            usados.add(intento);
            return intento;
        }
        idx++;
    }

    // Fallback extremo
    const rnd = Math.floor(Math.random() * 9999).toString().padStart(4, '0');
    const finalName = sanitizarNombreHojaExcel(`DC3_${rnd}`);
    usados.add(finalName);
    return finalName;
}

function deepClone(value) {
    return v8.deserialize(v8.serialize(value));
}

function reforzarBordesCriticosDC3(ws) {
    const thin = { style: 'thin', color: { argb: 'FF000000' } };

    // Borde superior en "Nombre y firma" (B31:F31)
    for (let col = 2; col <= 6; col++) {
        const cell = ws.getCell(31, col);
        const border = cell.border || {};
        cell.border = {
            ...border,
            top: thin
        };
    }

    // Borde derecho de columna AA en TODO el formato visible (AA1:AA43),
    // con énfasis en la parte superior donde está el logo para evitar que desaparezca.
    for (let row = 1; row <= 43; row++) {
        const cell = ws.getCell(row, 27); // AA
        const border = cell.border || {};
        cell.border = {
            ...border,
            right: thin
        };
    }
}

function cloneCellValue(value) {
    if (value === null || value === undefined) return value;
    if (typeof value === 'object') return deepClone(value);
    return value;
}

function clonarHojaDC3EnWorkbook(wsOrigen, wbOrigen, wbDestino, nombreHoja) {
    const wsDestino = wbDestino.addWorksheet(nombreHoja);

    wsDestino.properties = deepClone(wsOrigen.properties || {});
    wsDestino.pageSetup = deepClone(wsOrigen.pageSetup || {});
    wsDestino.headerFooter = deepClone(wsOrigen.headerFooter || null);
    wsDestino.views = deepClone(wsOrigen.views || []);
    wsDestino.state = wsOrigen.state || 'visible';

    const maxCols = 33;
    const maxRows = Math.max(43, wsOrigen.rowCount || 0);

    for (let col = 1; col <= maxCols; col++) {
        const srcCol = wsOrigen.getColumn(col);
        const dstCol = wsDestino.getColumn(col);

        if (srcCol.width !== undefined) dstCol.width = srcCol.width;
        if (srcCol.hidden !== undefined) dstCol.hidden = srcCol.hidden;
        if (srcCol.outlineLevel !== undefined) dstCol.outlineLevel = srcCol.outlineLevel;
        if (srcCol.style) dstCol.style = deepClone(srcCol.style);
    }

    for (let row = 1; row <= maxRows; row++) {
        const srcRow = wsOrigen.getRow(row);
        const dstRow = wsDestino.getRow(row);

        if (srcRow.height !== undefined) dstRow.height = srcRow.height;
        if (srcRow.hidden !== undefined) dstRow.hidden = srcRow.hidden;
        if (srcRow.outlineLevel !== undefined) dstRow.outlineLevel = srcRow.outlineLevel;

        for (let col = 1; col <= maxCols; col++) {
            const srcCell = srcRow.getCell(col);
            const dstCell = dstRow.getCell(col);

            dstCell.value = cloneCellValue(srcCell.value);
            if (srcCell.style && Object.keys(srcCell.style).length > 0) {
                dstCell.style = deepClone(srcCell.style);
            }
        }
    }

    if (Array.isArray(wsOrigen.model?.merges)) {
        for (const mergeRange of wsOrigen.model.merges) {
            try { wsDestino.mergeCells(mergeRange); } catch (_) { /* ignore already-merged */ }
        }
    }

    if (typeof wsOrigen.getImages === 'function') {
        const images = wsOrigen.getImages();
        for (const img of images) {
            const srcImage = wbOrigen.getImage(img.imageId);
            if (!srcImage) continue;

            const newImageId = wbDestino.addImage({
                extension: srcImage.extension,
                buffer: srcImage.buffer ? Buffer.from(srcImage.buffer) : undefined,
                base64: srcImage.base64 || undefined
            });

            const range = img.range || {};
            const plainRange = {};

            if (range.tl) {
                plainRange.tl = {
                    col: range.tl.col,
                    row: range.tl.row
                };
            }
            if (range.br) {
                plainRange.br = {
                    col: range.br.col,
                    row: range.br.row
                };
            }
            if (range.ext) {
                plainRange.ext = deepClone(range.ext);
            }
            if (range.editAs) {
                plainRange.editAs = range.editAs;
            }
            if (range.hyperlinks) {
                plainRange.hyperlinks = deepClone(range.hyperlinks);
            }

            wsDestino.addImage(newImageId, plainRange);
        }
    }

    // Refuerzo quirúrgico para evitar cortes visuales al abrir/editar en Google Sheets.
    reforzarBordesCriticosDC3(wsDestino);

    return wsDestino;
}

/**
 * Genera un solo Excel consolidado de DC-3 con una hoja por participante,
 * reutilizando el formato oficial existente de cada DC-3 individual.
 */
async function generarDC3Consolidado(cursoInfo, areaId, participantes, opciones = {}) {
    const agenteCapacitador = opciones.agente_capacitador || 'BIZNAGA RISK AND TECH S DE R.L DE C.V.';
    const instructorFirmaBuffer = opciones.instructor_firma_buffer || null;
    const instructorFirmaExt = opciones.instructor_firma_ext || null;
    const empresaLogoBuffer = opciones.empresa_logo_buffer || null;
    const empresaLogoExt = opciones.empresa_logo_ext || null;
    const usarOcupacionGenerica = opciones.usar_ocupacion_generica === true;

    if (!Array.isArray(participantes) || participantes.length === 0) {
        throw new Error('No hay participantes para generar DC-3 consolidado.');
    }

    const wbConsolidado = new ExcelJS.Workbook();
    const hojasUsadas = new Set();

    for (let i = 0; i < participantes.length; i++) {
        const p = participantes[i] || {};
        const bufferIndividual = await generarDC3({
            nombre_trabajador: p.nombre_completo,
            nombre: p.nombre || '',
            apellido_paterno: p.apellido_paterno || '',
            apellido_materno: p.apellido_materno || '',
            curp: p.curp || '',
            nombre_empresa: p.nombre_empresa || cursoInfo.nombre_empresa,
            rfc_empresa: p.rfc_empresa || cursoInfo.empresa_rfc,
            nombre_curso: p.nombre_curso || cursoInfo.nombre_curso,
            horas: cursoInfo.horas_informe || cursoInfo.curso_horas,
            fecha_inicio: cursoInfo.fecha_inicio,
            fecha_fin: cursoInfo.fecha_fin,
            area_id: p.area_id ?? areaId,
            instructor_nombre: cursoInfo.instructor_nombre || '',
            instructor_rfc: cursoInfo.instructor_rfc || '',
            agente_capacitador: agenteCapacitador,
            puesto_trabajador: p.puesto || '',
            usar_ocupacion_generica: usarOcupacionGenerica,
            folio_dc3: p.folio_dc3 || '',
            instructor_firma_buffer: instructorFirmaBuffer,
            instructor_firma_ext: instructorFirmaExt,
            empresa_logo_buffer: p.empresa_logo_buffer ?? empresaLogoBuffer,
            empresa_logo_ext: p.empresa_logo_ext ?? empresaLogoExt
        });

        const nombreBaseHoja = `${p.apellido_paterno || ''} ${p.nombre || ''}`.trim() || p.nombre_completo || `Participante ${i + 1}`;
        const nombreHoja = nombreHojaUnico(nombreBaseHoja, hojasUsadas);

        const wbTmp = new ExcelJS.Workbook();
        await wbTmp.xlsx.load(bufferIndividual);
        const wsTmp = wbTmp.worksheets[0];
        if (!wsTmp) continue;

        clonarHojaDC3EnWorkbook(wsTmp, wbTmp, wbConsolidado, nombreHoja);
    }

    const out = await wbConsolidado.xlsx.writeBuffer();
    return Buffer.from(out);
}

module.exports = {
    generarDC3,
    generarDC3Lote,
    generarDC3Consolidado,
    esEmpresaBiznaga,
    AREAS_TEMATICAS_STPS,
    OCUPACION_CNO
};
