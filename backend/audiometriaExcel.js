/**
 * Copia la plantilla de audiometría a
 * Expedientes_medicos/{empresa}/audiometrias/{paciente} y llena las celdas del registro.
 */

const sharp = require('sharp');

const PLANTILLA_ID = '1Nqjfn0tG1qimETg2zPIkF1Gt-07xWqPJMtjH5SEeI04';
const HOJA = 'Plantilla';
const FRECUENCIAS = [125, 250, 500, 750, 1000, 1500, 2000, 3000, 4000, 6000, 8000];
const OSEAS = new Set([250, 500, 750, 1000, 1500, 2000, 3000, 4000]);
const NIVELES_DB = [-10, 0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100, 110, 120];
const GRAFICO = { w: 980, h: 560, l: 64, r: 28, t: 46, b: 78 };

function drive() {
    return require('./driveService');
}

function limpiarNombreCarpeta(nombre) {
    return String(nombre || '').replace(/[<>:"/\\|?*]/g, '_').trim();
}

function texto(valor) {
    return String(valor ?? '').trim();
}

function siNo(valor) {
    const normal = texto(valor).toUpperCase();
    if (normal === 'SI' || normal === 'SÍ') return 'SI';
    if (normal === 'NO') return 'NO';
    return '';
}

function marcaSiNo(valor) {
    const respuesta = siNo(valor);
    return { si: respuesta === 'SI' ? 'X' : '', no: respuesta === 'NO' ? 'X' : '' };
}

function fechaVisible(valor) {
    const match = texto(valor).match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (!match) return texto(valor);
    return `${match[3]}/${match[2]}/${match[1]}`;
}

function valorNum(raw) {
    if (raw === null || raw === undefined || raw === '') return null;
    const numero = Number(raw);
    if (!Number.isFinite(numero) || numero < -10 || numero > 120) return null;
    return numero;
}

function umbralDe(umbrales, frecuencia) {
    return (umbrales || []).find((item) => Number(item?.frecuencia) === frecuencia) || {};
}

function valorDe(umbrales, frecuencia, campo) {
    return valorNum(umbralDe(umbrales, frecuencia)[campo]);
}

function xml(valor) {
    return String(valor ?? '').replace(/[&<>"']/g, (caracter) => ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&apos;'
    }[caracter]));
}

function yDb(db) {
    const alto = GRAFICO.h - GRAFICO.t - GRAFICO.b;
    return GRAFICO.t + ((db + 10) / 130) * alto;
}

function xFrecuencia(indice) {
    const ancho = GRAFICO.w - GRAFICO.l - GRAFICO.r;
    if (FRECUENCIAS.length <= 1) return GRAFICO.l;
    return GRAFICO.l + (indice * ancho) / (FRECUENCIAS.length - 1);
}

function puntosSerie(umbrales, campo, osea) {
    const puntos = [];
    FRECUENCIAS.forEach((frecuencia, indice) => {
        if (osea && !OSEAS.has(frecuencia)) return;
        const valor = valorDe(umbrales, frecuencia, campo);
        if (valor == null) return;
        puntos.push({ x: xFrecuencia(indice), y: yDb(valor), indice });
    });
    return puntos;
}

function trazos(puntos, color) {
    const grupos = [];
    let actual = [];
    puntos.forEach((punto, indice) => {
        actual.push(punto);
        const siguiente = puntos[indice + 1];
        if (!siguiente || siguiente.indice !== punto.indice + 1) {
            if (actual.length > 1) grupos.push(actual);
            actual = [];
        }
    });
    return grupos.map((grupo) => {
        const coords = grupo.map((punto) => `${punto.x.toFixed(1)},${punto.y.toFixed(1)}`).join(' ');
        return `<polyline points="${coords}" fill="none" stroke="${color}" stroke-width="2.2"/>`;
    }).join('');
}

function n1(valor) {
    return Number(valor).toFixed(1);
}

function marcasSerie(puntos, color, tipo) {
    return puntos.map((punto) => {
        const x = punto.x;
        const y = punto.y;
        if (tipo === 'circulo') {
            return `<circle cx="${n1(x)}" cy="${n1(y)}" r="6" fill="#ffffff" stroke="${color}" stroke-width="2.2"/>`;
        }
        if (tipo === 'x') {
            return `<g stroke="${color}" stroke-width="2.2"><line x1="${n1(x - 6)}" y1="${n1(y - 6)}" x2="${n1(x + 6)}" y2="${n1(y + 6)}"/><line x1="${n1(x - 6)}" y1="${n1(y + 6)}" x2="${n1(x + 6)}" y2="${n1(y - 6)}"/></g>`;
        }
        const signo = tipo === 'menor' ? -1 : 1;
        const punta = x + signo * 8;
        const base = x - signo * 5;
        return `<polyline points="${n1(base)},${n1(y - 7)} ${n1(punta)},${n1(y)} ${n1(base)},${n1(y + 7)}" fill="none" stroke="${color}" stroke-width="2.2"/>`;
    }).join('');
}

function svgAudiograma(titulo, lado, umbrales) {
    const color = lado === 'Od' ? '#c62828' : '#1565c0';
    const aire = puntosSerie(umbrales, `va${lado}`, false);
    const osea = puntosSerie(umbrales, `vo${lado}`, true).map((punto) => ({
        ...punto,
        x: punto.x + (lado === 'Od' ? -10 : 10)
    }));
    const piso = GRAFICO.h - GRAFICO.b;
    const lineas = NIVELES_DB.map((db) => {
        const y = yDb(db);
        const fuerte = db === 0 || db === 25;
        return `<line x1="${GRAFICO.l}" y1="${n1(y)}" x2="${GRAFICO.w - GRAFICO.r}" y2="${n1(y)}" stroke="${fuerte ? '#9e9e9e' : '#e6e6e6'}" stroke-width="1"${db === 25 ? ' stroke-dasharray="5 4"' : ''}/>`
            + `<text x="6" y="${n1(y + 4)}" font-family="Arial, sans-serif" font-size="13" fill="#555">${db}</text>`;
    }).join('');
    const columnas = FRECUENCIAS.map((frecuencia, indice) => {
        const x = xFrecuencia(indice);
        return `<line x1="${n1(x)}" y1="${GRAFICO.t}" x2="${n1(x)}" y2="${piso}" stroke="#f0f0f0"/>`
            + `<text x="${n1(x)}" y="${piso + 20}" text-anchor="middle" font-family="Arial, sans-serif" font-size="12" fill="#555">${frecuencia}</text>`;
    }).join('');
    const marcaLeyenda = lado === 'Od'
        ? `<circle cx="${GRAFICO.l + 8}" cy="${GRAFICO.h - 28}" r="6" fill="#ffffff" stroke="${color}" stroke-width="2.2"/>`
        : `<g stroke="${color}" stroke-width="2.2"><line x1="${GRAFICO.l + 2}" y1="${GRAFICO.h - 34}" x2="${GRAFICO.l + 14}" y2="${GRAFICO.h - 22}"/><line x1="${GRAFICO.l + 2}" y1="${GRAFICO.h - 22}" x2="${GRAFICO.l + 14}" y2="${GRAFICO.h - 34}"/></g>`;
    return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${GRAFICO.w}" height="${GRAFICO.h}" viewBox="0 0 ${GRAFICO.w} ${GRAFICO.h}">
  <rect width="100%" height="100%" fill="#ffffff"/>
  <text x="${GRAFICO.w / 2}" y="30" text-anchor="middle" font-family="Arial, sans-serif" font-size="22" font-weight="700" fill="#222">${xml(titulo)}</text>
  ${lineas}
  ${columnas}
  <text x="${(GRAFICO.l + GRAFICO.w - GRAFICO.r) / 2}" y="${GRAFICO.h - 6}" text-anchor="middle" font-family="Arial, sans-serif" font-size="13" fill="#555">Hz</text>
  ${trazos(aire, color)}
  ${trazos(osea, color)}
  ${marcasSerie(aire, color, lado === 'Od' ? 'circulo' : 'x')}
  ${marcasSerie(osea, color, lado === 'Od' ? 'menor' : 'mayor')}
  ${marcaLeyenda}
  <text x="${GRAFICO.l + 22}" y="${GRAFICO.h - 23}" font-family="Arial, sans-serif" font-size="14" fill="#333">Vía aérea</text>
  <text x="${GRAFICO.l + 150}" y="${GRAFICO.h - 23}" font-family="Arial, sans-serif" font-size="14" fill="#333">Vía ósea</text>
</svg>`;
}

async function pngAudiograma(titulo, lado, umbrales) {
    return sharp(Buffer.from(svgAudiograma(titulo, lado, umbrales))).png().toBuffer();
}

async function insertarGraficos(servicio, archivoId, carpetaId, folio, umbrales) {
    await servicio.permitirAccesoUrlsExternasGoogleSheet(archivoId);
    const graficos = [
        { celda: 'A28', titulo: 'Oído derecho', lado: 'Od', archivo: `${folio || 'AUD'} oido derecho.png` },
        { celda: 'J28', titulo: 'Oído izquierdo', lado: 'Oi', archivo: `${folio || 'AUD'} oido izquierdo.png` }
    ];
    const actualizaciones = [];
    for (const grafico of graficos) {
        const png = await pngAudiograma(grafico.titulo, grafico.lado, umbrales);
        const subido = await servicio.subirArchivo(png, grafico.archivo, 'image/png', carpetaId);
        const url = `https://drive.google.com/thumbnail?id=${encodeURIComponent(subido.id)}&sz=w1200`;
        actualizaciones.push(celda(grafico.celda, `=IMAGE("${url}")`));
    }
    await servicio.actualizarCeldasGoogleSheet(archivoId, actualizaciones);
    await servicio.aplicarFormatoRangoGoogleSheet(archivoId, {
        sheetTitle: HOJA,
        startRow: 28,
        endRow: 45,
        startColumn: 1,
        endColumn: 16,
        horizontalAlignment: 'CENTER',
        verticalAlignment: 'MIDDLE',
        wrapStrategy: 'CLIP'
    });
}

function nombreArchivo(folio, nombre, fecha) {
    const persona = texto(nombre).replace(/[<>:"/\\|?*]/g, ' ').replace(/\s+/g, ' ').slice(0, 80);
    return [folio || 'AUD', persona || 'paciente', texto(fecha)].filter(Boolean).join(' ').slice(0, 140);
}

function celda(a1, valor, hoja = HOJA) {
    return { range: `'${hoja}'!${a1}`, values: [[valor == null ? '' : valor]] };
}

function valorCelda(raw) {
    const numero = valorNum(raw);
    return numero == null ? '' : numero;
}

function construirActualizaciones(registro) {
    const datos = registro?.datos && typeof registro.datos === 'object' ? registro.datos : {};
    const umbrales = Array.isArray(datos.umbrales) ? datos.umbrales : [];
    const audifonos = marcaSiNo(datos.audifonos);
    const quimicos = marcaSiNo(datos.quimicos);
    const ototoxicos = texto(datos.ototoxicos);
    const extralaboral = texto(datos.ruidoExtralaboral);
    const actualizaciones = [
        celda('L2', texto(datos.tipoAudiometria)),
        celda('C3', texto(datos.nombre)),
        celda('E4', fechaVisible(datos.fechaElaboracion)),
        celda('I4', texto(datos.ocupacion)),
        celda('M4', texto(datos.edad)),
        celda('E5', texto(datos.usoProtector)),
        celda('O5', texto(datos.anosEnPuesto)),
        celda('F6', texto(datos.horasExposicion)),
        celda('O6', texto(datos.tipoRuido)),
        celda('I8', siNo(datos.perdidaUnilateral)),
        celda('O8', siNo(datos.perdidaBilateral)),
        celda('H9', siNo(datos.enfermedadSubita)),
        celda('L9', siNo(datos.enfermedadProgresiva)),
        celda('O9', siNo(datos.enfermedadFluctuante)),
        celda('F10', siNo(datos.perdidaAuditiva)),
        celda('K10', texto(datos.perdidaParentesco)),
        celda('F11', siNo(datos.enfermedadOido)),
        celda('K11', texto(datos.enfermedadCual)),
        celda('P11', texto(datos.enfermedadParentesco)),
        celda('F12', siNo(datos.trastornosComunicacion)),
        celda('K12', texto(datos.trastornosTipo)),
        celda('P12', texto(datos.trastornosObservaciones)),
        celda('A13', `OBSERVACIONES: ${texto(datos.observacionesHeredo)}`.trim()),
        celda('L15', siNo(datos.infecciosos)),
        celda('K16', siNo(datos.traumatismo)),
        celda('G17', audifonos.si),
        celda('I17', audifonos.no),
        celda('M17', texto(datos.audifonosHoras)),
        celda('G18', quimicos.si),
        celda('I18', quimicos.no),
        celda('M18', texto(datos.quimicosHoras)),
        celda('K19', ototoxicos),
        celda('M19', ''),
        celda('N20', extralaboral),
        celda('P20', ''),
        celda('A21', '3. DATOS CLÍNICOS'),
        celda('G22', siNo(datos.disminucionAudicion)),
        celda('O22', siNo(datos.otalgia)),
        celda('A23', 'TINNITUS'),
        celda('F23', texto(datos.tinnitus)),
        celda('O23', siNo(datos.mareos)),
        celda('G24', siNo(datos.vertigo)),
        celda('O24', siNo(datos.otorrea)),
        celda('F25', siNo(datos.oyeBien)),
        celda('M25', texto(datos.oyeBienDesdeCuando)),
        celda('F26', siNo(datos.repetirFrases)),
        celda('M26', siNo(datos.aumentarVolumenTv)),
        celda('F27', siNo(datos.oyeMejorConRuido)),
        celda('M27', siNo(datos.molestanRuidosIntensos)),
        celda('C47', texto(datos.diagnostico)),
        celda('C48', texto(datos.personalElaboro)),
        celda('E48', texto(datos.cedulaProfesional))
    ];

    FRECUENCIAS.forEach((frecuencia, indice) => {
        const umbral = umbralDe(umbrales, frecuencia);
        const fila = 4 + indice;
        actualizaciones.push(celda(`B${fila}`, valorCelda(umbral.vaOd), 'Resultados'));
        actualizaciones.push(celda(`D${fila}`, valorCelda(umbral.vaOi), 'Resultados'));
    });
    actualizaciones.push(celda('D15', '=(D8+D9+D10+D12)/11', 'Resultados'));
    actualizaciones.push({
        range: `'${HOJA}'!A50:E74`,
        values: Array.from({ length: 25 }, () => ['', '', '', '', ''])
    });

    return actualizaciones;
}

async function asegurarCarpetaAudiometrias(nombreEmpresa) {
    const servicio = drive();
    if (!servicio.driveDisponible()) {
        const error = new Error('Google Drive no está disponible');
        error.status = 503;
        throw error;
    }
    const nombre = limpiarNombreCarpeta(nombreEmpresa);
    if (!nombre) {
        const error = new Error('La empresa no tiene nombre para crear su carpeta');
        error.status = 400;
        throw error;
    }
    const carpetaExpedientes = await servicio.obtenerOCrearCarpeta('Expedientes_medicos', 'root');
    const carpetaEmpresa = await servicio.obtenerOCrearCarpeta(nombre, carpetaExpedientes);
    return servicio.obtenerOCrearCarpeta('audiometrias', carpetaEmpresa);
}

async function asegurarCarpetaPaciente(nombreEmpresa, nombrePaciente) {
    const carpetaAudiometrias = await asegurarCarpetaAudiometrias(nombreEmpresa);
    const servicio = drive();
    const paciente = limpiarNombreCarpeta(nombrePaciente).slice(0, 120) || 'paciente';
    const carpetaPaciente = await servicio.obtenerOCrearCarpeta(paciente, carpetaAudiometrias);
    console.log(`[audiometria] Carpeta paciente lista: Expedientes_medicos/${limpiarNombreCarpeta(nombreEmpresa)}/audiometrias/${paciente}`);
    return { carpetaPaciente, carpetaAudiometrias, paciente };
}

async function archivoTieneHojasCompletas(servicio, archivoId) {
    const hojas = await servicio.listarHojasGoogleSheet(archivoId);
    const set = new Set((hojas || []).map((h) => String(h || '').trim()));
    return set.has('Plantilla') && set.has('Resultados');
}

async function asegurarExcelEnCarpetaPaciente(servicio, archivoIdActual, nombre, carpetaPaciente) {
    let archivoId = texto(archivoIdActual);
    if (archivoId) {
        const existe = await servicio.verificarArchivoExiste(archivoId);
        if (!existe) {
            archivoId = '';
        } else if (!(await archivoTieneHojasCompletas(servicio, archivoId))) {
            console.warn(`[audiometria] El Excel ${archivoId} no tiene hoja Resultados; se recrea desde la plantilla`);
            try {
                await servicio.eliminarArchivo(archivoId);
            } catch (_e) { /* ignore */ }
            archivoId = '';
        }
    }

    if (!archivoId) {
        const copia = await servicio.copiarGoogleSheetACarpeta(PLANTILLA_ID, nombre, carpetaPaciente);
        return {
            id: copia.id,
            webViewLink: copia.webViewLink || `https://docs.google.com/spreadsheets/d/${copia.id}/edit`
        };
    }

    await servicio.renombrarArchivoPorId(archivoId, nombre);
    await servicio.moverArchivoDrive(archivoId, carpetaPaciente);
    return {
        id: archivoId,
        webViewLink: `https://docs.google.com/spreadsheets/d/${archivoId}/edit`
    };
}

function nombresGraficas(folio) {
    const prefijo = texto(folio) || 'AUD';
    return [
        `${prefijo} oido derecho.png`,
        `${prefijo} oido izquierdo.png`
    ];
}

async function eliminarGraficasPrevias(servicio, carpetaId, folio) {
    if (!carpetaId) return;
    for (const nombre of nombresGraficas(folio)) {
        for (;;) {
            const archivo = await servicio.buscarArchivo(nombre, carpetaId);
            if (!archivo?.id) break;
            await servicio.eliminarArchivo(archivo.id);
        }
    }
}

async function guardarExcelAudiometria(registro) {
    const servicio = drive();
    const { carpetaPaciente, carpetaAudiometrias } = await asegurarCarpetaPaciente(
        registro.empresaNombre,
        registro.datos?.nombre || registro.nombre
    );
    const nombre = nombreArchivo(registro.folio, registro.datos?.nombre || registro.nombre, registro.datos?.fechaElaboracion);
    const excel = await asegurarExcelEnCarpetaPaciente(
        servicio,
        registro.driveFileId,
        nombre,
        carpetaPaciente
    );
    const archivoId = excel.id;
    const enlace = excel.webViewLink;

    const registroCompleto = { ...registro, folio: registro.folio };
    const actualizaciones = construirActualizaciones(registroCompleto);
    const dePlantilla = actualizaciones.filter((item) => String(item.range || '').includes(`'${HOJA}'!`));
    const deResultados = actualizaciones.filter((item) => String(item.range || '').includes("'Resultados'!"));

    if (dePlantilla.length) {
        await servicio.actualizarCeldasGoogleSheet(archivoId, dePlantilla);
    }
    await servicio.aplicarFormatoRangoGoogleSheet(archivoId, {
        sheetTitle: HOJA,
        startRow: 2,
        endRow: 27,
        startColumn: 1,
        endColumn: 16,
        horizontalAlignment: 'LEFT',
        verticalAlignment: 'MIDDLE',
        wrapStrategy: 'WRAP'
    });

    if (deResultados.length) {
        try {
            await servicio.actualizarCeldasGoogleSheet(archivoId, deResultados);
        } catch (error) {
            console.error('[audiometria] No se pudieron escribir umbrales en Resultados:', error.message);
            throw error;
        }
    }

    const umbrales = Array.isArray(registroCompleto.datos?.umbrales) ? registroCompleto.datos.umbrales : [];
    await eliminarGraficasPrevias(servicio, carpetaPaciente, registroCompleto.folio);
    await eliminarGraficasPrevias(servicio, carpetaAudiometrias, registroCompleto.folio);
    await insertarGraficos(servicio, archivoId, carpetaPaciente, registroCompleto.folio, umbrales);

    return {
        driveFileId: archivoId,
        driveUrl: enlace,
        nombre
    };
}

module.exports = {
    asegurarCarpetaAudiometrias,
    guardarExcelAudiometria,
    construirActualizaciones
};
