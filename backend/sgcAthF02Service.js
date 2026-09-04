/**
 * ATH-F-02 · Descripción y perfil de puesto — persistencia en biznaga_sgc y sync con Drive.
 * Arquetipo archivero: una hoja Google Sheet por perfil + PDF firmado en carpeta dedicada.
 */
const ExcelJS = require('exceljs');
const driveService = require('./driveService');
const {
    asegurarTablaSgcFormatoDatos,
    persistirRegistroSgc,
    obtenerRegistroSgcPersistido
} = require('./sgcDgF05Service');
const excelHistorial = require('./sgcExcelHistorialService');

const CODIGO_FORMATO = 'ATH-F-02';
const PLANTILLA_XLSX_DRIVE_ID = '1GgIuHFxg0EkFjlz4csBSXKqMQpi8jEJA';
const DRIVE_FILE_ID_SISTEMA = '1PH6_usxtmpYsr8AOYqlGi9Z9fJEZ4hywDEqKDjIfKOk';
const TEMPLATE_DRIVE_ID = PLANTILLA_XLSX_DRIVE_ID;
const CARPETA_DRIVE_ID = '1IIlNXxAE2h-AiVbZDDr6zuGa87NXdFLm';
const CARPETA_PDF_FIRMADOS_ID = '17z3f9ss1_lbuk1pTV9eTg2T6Dc8hjquJ';
const NOMBRE_ARCHIVO_DRIVE = 'ATH-F-02 Descripción y perfil de puesto (sistema)';
const SHEET_TITLE = 'Plantilla';

const REVISION_CELL = { row: 2, col: 24 };
const FECHA_REV_CELL = { row: 3, col: 24 };

const CELLS = {
    puesto: { row: 7, startCol: 7, endCol: 15 },
    areaDepartamento: { row: 8, startCol: 7, endCol: 15 },
    puestoAlQueReporta: { row: 11, startCol: 7, endCol: 14 },
    puestosQueLeReportan: { row: 11, startCol: 16, endCol: 20 },
    objetivo: { startRow: 13, endRow: 16, startCol: 1, endCol: 15 },
    funciones: { startRow: 19, endRow: 44, startCol: 1, endCol: 15 },
    formacion: { startRow: 71, endRow: 78, startCol: 1, endCol: 15 },
    habilidades: { startRow: 80, endRow: 84, startCol: 1, endCol: 15 },
    conocimiento: { startRow: 86, endRow: 89, startCol: 1, endCol: 15 }
};

const EDAD_ROW = 48;
const EDAD_MARKS = { minima: 7, maxima: 13, indistinto: 20 };

const SEXO_ROW = 50;
const SEXO_MARKS = { masculino: 7, femenino: 13, indistinto: 20 };

const ESTADO_CIVIL_ROW = 52;
const ESTADO_CIVIL_MARKS = { soltero: 7, casado: 13, indistinto: 20 };

const ESC_ROWS = {
    nivel1: 54,
    nivel2: 56,
    especialidad: 58,
    maestria: 60
};
const ESC_MARKS = {
    primaria: { row: 54, col: 7 },
    secundaria: { row: 54, col: 13 },
    bachillerato: { row: 54, col: 20 },
    tecnico: { row: 54, col: 26 },
    tsu: { row: 56, col: 7 },
    licenciatura: { row: 56, col: 13 },
    licText: { row: 56, col: 20 },
    especialidad: { row: 58, col: 7 },
    espText: { row: 58, col: 14 },
    maestria: { row: 60, col: 7 },
    maestText: { row: 60, col: 14 },
    otro: { row: 60, col: 20 }
};

const EXP_HEADER_ROW = 64;
const EXP_DATA_ROWS = [65, 66, 67, 68];
const EXP_LEFT = { enQueStart: 1, enQueEnd: 15, tiempoCol: 16 };

const REQ_ROWS = {
    computadora: 92,
    software: 94,
    informacion: 96,
    herramientas: 98,
    uniformes: 100,
    otros: 102
};
const REQ_MARK_COL = 12;
const REQ_DETAIL_COL = 14;

const REL_INTERNAS = { startRow: 107, endRow: 116, actorStart: 1, actorEnd: 15, motivoStart: 16, motivoEnd: 24 };
const REL_EXTERNAS = { startRow: 120, endRow: 128, actorStart: 1, actorEnd: 15, motivoStart: 16, motivoEnd: 24 };

const MAX_FUNCIONES = CELLS.funciones.endRow - CELLS.funciones.startRow + 1;
const MAX_EXP_FILAS = EXP_DATA_ROWS.length;

const ATH_F02_FUNCIONES_DEFECTO = [
    'Conocer los procesos que se llevan a cabo dentro de laboratorio.',
    'Establecer estrategias y procedimientos de carácter técnico para el desarrollo de las actividades en el laboratorio',
    'Revisar y verificar, los resultados de los análisis realizados.',
    'Supervisar la correcta aplicación de los métodos de prueba, procedimientos e instructivos técnicos.',
    'Supervisar los controles de calidad de los diferentes análisis que se realizan.',
    'Vigilar que se lleven a cabo los sistemas de control de calidad, tanto internos como externos.',
    'Atender en forma directa las reclamaciones y sugerencias que se formulen en la prestación del servicio y coadyuvar en la resolución',
    'Conocer, cumplir y aplicar la normatividad vigente.',
    'Establecer conforme a la normatividad, los criterios para la toma y análisis de muestras.',
    'Vigilar y supervisar el apego a la normatividad sanitaria el desecho de material y muestras ya analizadas.',
    'Realizar las notificaciones a epidemiología estatal, de acuerdo a lo establecido a la NOM 017.',
    'Vigilar el uso adecuado del uniforme y equipo de seguridad para el personal.',
    'Informar deterioros, descomposturas de aparatos, instrumentos, equipos, utensilios, accesorios, así como en las instalaciones eléctricas, hidráulicas y de drenaje.',
    'Informar y solicitar oportunamente los requerimientos de material o insumos.',
    'Mantener en óptimas condiciones el material y los equipos del laboratorio.',
    'Mantener completa su plantilla de personal para el logro de metas del área.',
    'Dar seguimiento a los procesos de Recursos Humanos para el cumplimiento de reglamento Interior de Trabajo, reclutamiento, capacitación, administración de personal y desarrollo de los colaboradores del área bajo su cargo.',
    'Participar activamente en el sistema de gestión de calidad de la institución.',
    'Proponer acciones de mejora o correctivas que ayuden a mejorar el logro de los objetivos.',
    'Participar de forma efectiva en los procesos de comunicación con las diferentes áreas de interacción.',
    'Participar en eventos y demás acciones de la institución.',
    'Generar los reportes e información requerida por la institución.',
    'Asistir a las juntas, capacitaciones y demás actividades convocadas por la institución.',
    'Seguir con las políticas, procedimientos y protocolos establecidos por la institución para el desempeño de sus funciones.',
    'Cumplir con las políticas y reglamentos establecidos por la institución.',
    'Seguir con las políticas, procedimientos y protocolos normativos en materia de seguridad e higiene establecidos.'
];

const DATOS_DEFECTO = {
    revision: '00',
    fechaRevision: '2025-07-10',
    fechaElaboracion: '2025-07-10',
    perfiles: [],
    perfilActivoId: null
};

const REQUERIMIENTO_DEFECTO = () => ({ activo: false, detalle: '' });
const EXP_ITEM_DEFECTO = () => ({ enQue: '', tiempo: '' });
const RELACION_DEFECTO = () => ({ actor: '', motivo: '' });

function nuevoId() {
    try {
        return require('crypto').randomUUID();
    } catch {
        return `ath02-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
    }
}

function normalizarSaltos(texto) {
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
            return normalizarSaltos(valor.richText.map((p) => p.text || '').join(''));
        }
        if (valor.text) return normalizarSaltos(String(valor.text));
    }
    return normalizarSaltos(String(valor));
}

function formatearFechaIso(fecha) {
    if (!fecha) return '';
    const crudo = String(fecha).trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(crudo)) return crudo;
    const d = fecha instanceof Date ? fecha : new Date(fecha);
    if (Number.isNaN(d.getTime())) {
        const m = crudo.match(/(\d{1,2})[-/](\d{1,2})[-/](\d{2,4})/);
        if (m) {
            const day = m[1].padStart(2, '0');
            const month = m[2].padStart(2, '0');
            let year = m[3];
            if (year.length === 2) year = `20${year}`;
            return `${year}-${month}-${day}`;
        }
        const iso = crudo.match(/(\d{4})-(\d{2})-(\d{2})/);
        return iso ? iso[0] : crudo.slice(0, 10);
    }
    const y = d.getFullYear();
    const mo = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${mo}-${day}`;
}

function formatearFechaDisplay(iso) {
    const f = formatearFechaIso(iso);
    if (!f) return '';
    const [y, m, d] = f.split('-');
    return `${d}-${m}-${y.slice(-2)}`;
}

function fechaHoyIso() {
    return excelHistorial.fechaAhoraMexicoIso().slice(0, 10);
}

function extraerRevision(texto) {
    const m = String(texto || '').match(/(\d{2})/);
    return m ? m[1] : '00';
}

function marcaCheckbox(activo) {
    return activo ? 'X' : '';
}

function leerMarca(texto) {
    const t = String(texto || '').trim().toUpperCase();
    return t === 'X' || t === '✓' || t === '✔' || t === 'SI' || t === 'SÍ' || t === 'TRUE' || t === '1';
}

function sanitizarNombreHoja(nombre) {
    return String(nombre || '').trim()
        .replace(/[/\\?*:[\]]/g, '_')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 90);
}

function sanitizarPdfFirmado(raw) {
    if (!raw || typeof raw !== 'object') return null;
    const driveFileId = String(raw.driveFileId || raw.drive_file_id || '').trim();
    if (!driveFileId) return null;
    return {
        driveFileId,
        nombreArchivo: String(raw.nombreArchivo || raw.nombre_archivo || 'ATH-F-02 firmado.pdf').trim(),
        webViewLink: String(raw.webViewLink || raw.web_view_link || '').trim()
            || `https://drive.google.com/file/d/${driveFileId}/view?usp=drive_link`,
        previewUrl: String(raw.previewUrl || '').trim()
            || `https://drive.google.com/file/d/${driveFileId}/preview`,
        fechaSubida: formatearFechaIso(raw.fechaSubida || raw.fecha_subida) || null
    };
}

function sanitizarRequerimiento(raw) {
    const base = raw && typeof raw === 'object' ? raw : {};
    return {
        activo: !!base.activo,
        detalle: normalizarSaltos(base.detalle || '')
    };
}

function sanitizarEscolaridad(raw) {
    const base = raw && typeof raw === 'object' ? raw : {};
    const niveles = ['primaria', 'secundaria', 'bachillerato', 'tecnico', 'tsu', 'licenciatura', 'especialidad', 'maestria', 'otro'];
    let nivel = String(base.nivel || base.escNivel || '').trim().toLowerCase();
    if (!nivel) {
        for (const n of niveles) {
            if (base[n]) {
                nivel = n;
                break;
            }
        }
    }
    const out = {
        primaria: false,
        secundaria: false,
        bachillerato: false,
        tecnico: false,
        tsu: false,
        licenciatura: false,
        licText: normalizarSaltos(base.licText || base.lic_text || base.licenciaturaEn || ''),
        especialidad: false,
        espText: normalizarSaltos(base.espText || base.esp_text || base.especialidadEn || ''),
        maestria: false,
        maestText: normalizarSaltos(base.maestText || base.maest_text || base.maestriaEn || ''),
        otro: false,
        otroDetalle: normalizarSaltos(base.otroDetalle || base.otro_detalle || '')
    };
    if (niveles.includes(nivel)) {
        out[nivel] = true;
    }
    return out;
}

function sanitizarExpItem(raw) {
    const base = raw && typeof raw === 'object' ? raw : {};
    return {
        enQue: normalizarSaltos(base.enQue || base.en_que || ''),
        tiempo: normalizarSaltos(base.tiempo || '')
    };
}

function sanitizarRelacion(raw) {
    const base = raw && typeof raw === 'object' ? raw : {};
    return {
        actor: normalizarSaltos(base.actor || ''),
        motivo: normalizarSaltos(base.motivo || '')
    };
}

function conFilasMinimas(lista, minimo, factory) {
    const out = Array.isArray(lista) ? [...lista] : [];
    while (out.length < minimo) out.push(factory());
    return out;
}

function normalizarOpcionUnica(valor, opciones) {
    const t = String(valor || '').trim().toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '');
    if (!t) return '';
    for (const op of opciones) {
        const key = String(op.key || op).toLowerCase()
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '');
        const aliases = Array.isArray(op.aliases) ? op.aliases : [];
        if (t === key || aliases.some((a) => t.includes(String(a).toLowerCase()))) {
            return op.key || op;
        }
    }
    return String(valor || '').trim();
}

function sanitizarFunciones(raw) {
    const lista = Array.isArray(raw) ? raw : [];
    return lista
        .map((item) => {
            if (typeof item === 'string') return normalizarSaltos(item.replace(/^\d+\.\s*/, ''));
            return normalizarSaltos(item?.texto || item?.descripcion || '');
        })
        .filter(Boolean)
        .slice(0, MAX_FUNCIONES);
}

function crearPerfilVacio() {
    return {
        id: nuevoId(),
        puesto: '',
        areaDepartamento: '',
        puestoAlQueReporta: '',
        puestosQueLeReportan: '',
        objetivo: '',
        funciones: [...ATH_F02_FUNCIONES_DEFECTO],
        edad: '',
        edadMinima: '',
        edadMaxima: '',
        edadIndistinto: false,
        sexo: '',
        estadoCivil: '',
        escNivel: '',
        esc: sanitizarEscolaridad({}),
        experiencias: [],
        experiencia: EXP_ITEM_DEFECTO(),
        experienciaIzq: [],
        experienciaDer: [],
        formacionCompetenciasTecnicas: '',
        habilidadesBlandas: '',
        conocimientoEquipoOperacion: '',
        requerimientos: {
            computadora: REQUERIMIENTO_DEFECTO(),
            software: REQUERIMIENTO_DEFECTO(),
            informacion: REQUERIMIENTO_DEFECTO(),
            herramientas: REQUERIMIENTO_DEFECTO(),
            uniformes: REQUERIMIENTO_DEFECTO(),
            otros: REQUERIMIENTO_DEFECTO()
        },
        relacionesInternas: [],
        relacionesExternas: [],
        pdfFirmado: null,
        nombreHoja: ''
    };
}

function sanitizarPerfil(raw) {
    const base = raw && typeof raw === 'object' ? raw : {};
    const req = base.requerimientos && typeof base.requerimientos === 'object' ? base.requerimientos : {};
    const esc = sanitizarEscolaridad(base.esc || base.escolaridad);
    const nivelesEsc = ['primaria', 'secundaria', 'bachillerato', 'tecnico', 'tsu', 'licenciatura', 'especialidad', 'maestria', 'otro'];
    let escNivel = String(base.escNivel || base.esc_nivel || '').trim().toLowerCase();
    if (!escNivel) {
        for (const n of nivelesEsc) {
            if (esc[n]) {
                escNivel = n;
                break;
            }
        }
    }
    let edadIndistinto = !!(base.edadIndistinto || base.edad_indistinto)
        || normalizarOpcionUnica(base.edad, [{ key: 'indistinto' }]) === 'indistinto';
    let edadMinima = edadIndistinto
        ? ''
        : String(base.edadMinima || base.edad_minima || '').trim();
    let edadMaxima = edadIndistinto
        ? ''
        : String(base.edadMaxima || base.edad_maxima || '').trim();
    let edad = edadIndistinto ? 'indistinto' : '';
    const experiencia = sanitizarExpItem(
        base.experiencia
        || (Array.isArray(base.experiencias) ? base.experiencias[0] : null)
        || (Array.isArray(base.experienciaIzq) ? base.experienciaIzq[0] : null)
        || (Array.isArray(base.experienciaDer) ? base.experienciaDer[0] : null)
        || {}
    );
    const experienciasRaw = Array.isArray(base.experiencias)
        ? base.experiencias
        : (Array.isArray(base.experienciaIzq) ? base.experienciaIzq : []);
    const experiencias = conFilasMinimas(
        experienciasRaw.map(sanitizarExpItem),
        0,
        EXP_ITEM_DEFECTO
    ).slice(0, MAX_EXP_FILAS);
    if (!experiencias.length && (experiencia.enQue || experiencia.tiempo)) {
        experiencias.push(experiencia);
    }
    return {
        id: String(base.id || '').trim() || nuevoId(),
        puesto: String(base.puesto || '').trim(),
        areaDepartamento: String(base.areaDepartamento || base.area_departamento || '').trim(),
        puestoAlQueReporta: normalizarSaltos(base.puestoAlQueReporta || base.puesto_al_que_reporta || ''),
        puestosQueLeReportan: normalizarSaltos(base.puestosQueLeReportan || base.puestos_que_le_reportan || ''),
        objetivo: normalizarSaltos(base.objetivo || ''),
        funciones: sanitizarFunciones(base.funciones),
        edad,
        edadMinima,
        edadMaxima,
        edadIndistinto,
        sexo: normalizarOpcionUnica(base.sexo, [
            { key: 'masculino', aliases: ['hombre', 'm'] },
            { key: 'femenino', aliases: ['mujer', 'f'] },
            { key: 'indistinto', aliases: ['na', 'n/a'] }
        ]),
        estadoCivil: normalizarOpcionUnica(base.estadoCivil || base.estado_civil, [
            { key: 'soltero', aliases: ['soltera'] },
            { key: 'casado', aliases: ['casada'] },
            { key: 'indistinto', aliases: ['na', 'n/a'] }
        ]),
        esc,
        escNivel,
        experiencia: experiencias[0] || experiencia,
        experiencias,
        experienciaIzq: experiencias,
        experienciaDer: conFilasMinimas(
            (Array.isArray(base.experienciaDer) ? base.experienciaDer : []).map(sanitizarExpItem),
            0,
            EXP_ITEM_DEFECTO
        ).slice(0, MAX_EXP_FILAS),
        formacionCompetenciasTecnicas: normalizarSaltos(
            base.formacionCompetenciasTecnicas || base.formacion_competencias_tecnicas || ''
        ),
        habilidadesBlandas: normalizarSaltos(base.habilidadesBlandas || base.habilidades_blandas || ''),
        conocimientoEquipoOperacion: normalizarSaltos(
            base.conocimientoEquipoOperacion || base.conocimiento_equipo_operacion || ''
        ),
        requerimientos: {
            computadora: sanitizarRequerimiento(req.computadora),
            software: sanitizarRequerimiento(req.software),
            informacion: sanitizarRequerimiento(req.informacion),
            herramientas: sanitizarRequerimiento(req.herramientas),
            uniformes: sanitizarRequerimiento(req.uniformes),
            otros: sanitizarRequerimiento(req.otros)
        },
        relacionesInternas: (Array.isArray(base.relacionesInternas) ? base.relacionesInternas : [])
            .map(sanitizarRelacion)
            .filter((r) => r.actor || r.motivo),
        relacionesExternas: (Array.isArray(base.relacionesExternas) ? base.relacionesExternas : [])
            .map(sanitizarRelacion)
            .filter((r) => r.actor || r.motivo),
        pdfFirmado: sanitizarPdfFirmado(base.pdfFirmado || base.pdf_firmado),
        nombreHoja: String(base.nombreHoja || base.nombre_hoja || '').trim()
    };
}

function esPerfilLegacyPlano(base) {
    return !Array.isArray(base.perfiles)
        && (base.puesto || base.areaDepartamento || base.objetivo || base.funciones);
}

function sanitizarDatos(raw) {
    const base = raw && typeof raw === 'object' ? raw : {};
    let perfilesRaw = [];
    if (Array.isArray(base.perfiles)) {
        perfilesRaw = base.perfiles;
    } else if (esPerfilLegacyPlano(base)) {
        perfilesRaw = [base];
    }
    const perfiles = perfilesRaw.map(sanitizarPerfil);
    const perfilActivoId = base.perfilActivoId || base.perfil_activo_id
        ? String(base.perfilActivoId || base.perfil_activo_id)
        : (perfiles[0]?.id || null);
    return {
        revision: extraerRevision(base.revision || DATOS_DEFECTO.revision),
        fechaRevision: formatearFechaIso(base.fechaRevision) || DATOS_DEFECTO.fechaRevision,
        fechaElaboracion: formatearFechaIso(base.fechaElaboracion) || DATOS_DEFECTO.fechaElaboracion,
        perfiles,
        perfilActivoId: perfilActivoId && perfiles.some((p) => p.id === perfilActivoId)
            ? perfilActivoId
            : (perfiles[0]?.id || null)
    };
}

function resolverPerfilActivo(datos) {
    const lista = Array.isArray(datos?.perfiles) ? datos.perfiles : [];
    if (!lista.length) return crearPerfilVacio();
    const id = datos?.perfilActivoId;
    if (id) {
        const found = lista.find((p) => p.id === id);
        if (found) return found;
    }
    return lista[0];
}

function datosConPerfilActivo(datos, perfil) {
    return sanitizarDatos({
        ...(datos || {}),
        perfilActivoId: perfil?.id || null
    });
}

function perfilTieneContenido(p) {
    if (!p) return false;
    if (p.pdfFirmado?.driveFileId) return true;
    return !!(
        p.puesto
        || p.areaDepartamento
        || p.objetivo
        || (p.funciones || []).length
        || p.puestoAlQueReporta
        || p.puestosQueLeReportan
        || p.formacionCompetenciasTecnicas
        || p.habilidadesBlandas
        || p.conocimientoEquipoOperacion
    );
}

function resolverNombreHojaPerfil(perfil) {
    const titulo = sanitizarNombreHoja(perfil?.puesto);
    if (titulo) return titulo;
    const id = String(perfil?.id || '').trim();
    if (id) return `BORRADOR-${id.slice(0, 8)}`;
    return 'Sin-nombre';
}

function esHojaPerfilAthF02(titulo) {
    const t = String(titulo || '').trim();
    if (!t || t === SHEET_TITLE) return false;
    if (/^plantilla$/i.test(t)) return false;
    return true;
}

function snapshotComparable(datos) {
    const d = sanitizarDatos(datos);
    return {
        revision: d.revision,
        fechaRevision: d.fechaRevision,
        perfiles: d.perfiles.map((p) => ({
            id: p.id,
            puesto: p.puesto,
            areaDepartamento: p.areaDepartamento,
            puestoAlQueReporta: p.puestoAlQueReporta,
            puestosQueLeReportan: p.puestosQueLeReportan,
            objetivo: p.objetivo,
            funciones: p.funciones,
            edad: p.edad,
            edadMinima: p.edadMinima,
            edadMaxima: p.edadMaxima,
            edadIndistinto: p.edadIndistinto,
            sexo: p.sexo,
            estadoCivil: p.estadoCivil,
            escNivel: p.escNivel,
            esc: p.esc,
            experiencia: p.experiencia,
            experiencias: p.experiencias,
            experienciaIzq: p.experienciaIzq,
            experienciaDer: p.experienciaDer,
            formacionCompetenciasTecnicas: p.formacionCompetenciasTecnicas,
            habilidadesBlandas: p.habilidadesBlandas,
            conocimientoEquipoOperacion: p.conocimientoEquipoOperacion,
            requerimientos: p.requerimientos,
            relacionesInternas: p.relacionesInternas,
            relacionesExternas: p.relacionesExternas,
            pdfFirmado: p.pdfFirmado ? {
                driveFileId: p.pdfFirmado.driveFileId,
                nombreArchivo: p.pdfFirmado.nombreArchivo
            } : null
        })),
        perfilActivoId: d.perfilActivoId || null
    };
}

function contenidoEsEquivalente(a, b) {
    return JSON.stringify(snapshotComparable(a)) === JSON.stringify(snapshotComparable(b));
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
    return `'${String(sheetTitle).replace(/'/g, "''")}'!${celda}`;
}

function pushUpdate(actualizaciones, row, col, valor, sheetTitle) {
    actualizaciones.push({
        range: rangoSheet(`${columnaALetra(col)}${row}`, sheetTitle),
        values: [[valor ?? '']]
    });
}

function leerCelda(ws, row, col) {
    return celdaATexto(ws.getRow(row).getCell(col).value);
}

function configCeldaARango(config) {
    if (!config) {
        return { startRow: 1, endRow: 1, startCol: 1, endCol: 1 };
    }
    if (config.startRow != null && config.endRow != null) {
        return config;
    }
    const row = Number(config.row);
    return {
        startRow: row,
        endRow: row,
        startCol: Number(config.startCol),
        endCol: Number(config.endCol ?? config.startCol)
    };
}

function leerRango(ws, config) {
    const c = configCeldaARango(config);
    for (let row = c.startRow; row <= c.endRow; row++) {
        for (let col = c.startCol; col <= c.endCol; col++) {
            const texto = leerCelda(ws, row, col);
            if (texto) return texto;
        }
    }
    return '';
}

function leerBloqueFilas(ws, config) {
    const lineas = [];
    for (let row = config.startRow; row <= config.endRow; row++) {
        const texto = leerRango(ws, { startRow: row, endRow: row, startCol: config.startCol, endCol: config.endCol });
        if (texto) lineas.push(texto);
    }
    return normalizarSaltos(lineas.join('\n'));
}

function leerEdadDesdeHoja(ws) {
    const minCell = leerCelda(ws, EDAD_ROW, EDAD_MARKS.minima);
    const maxCell = leerCelda(ws, EDAD_ROW, EDAD_MARKS.maxima);
    const indCell = leerCelda(ws, EDAD_ROW, EDAD_MARKS.indistinto);
    const indistinto = leerMarca(indCell) || (leerMarca(minCell) && leerMarca(maxCell));
    if (indistinto) {
        return {
            edadIndistinto: true,
            edadMinima: '',
            edadMaxima: '',
            edad: 'indistinto'
        };
    }
    return {
        edadIndistinto: false,
        edadMinima: leerMarca(minCell) ? '' : minCell,
        edadMaxima: leerMarca(maxCell) ? '' : maxCell,
        edad: ''
    };
}

function pushEdad(actualizaciones, perfil, sheetTitle) {
    const p = sanitizarPerfil(perfil);
    if (p.edadIndistinto) {
        pushUpdate(actualizaciones, EDAD_ROW, EDAD_MARKS.minima, 'X', sheetTitle);
        pushUpdate(actualizaciones, EDAD_ROW, EDAD_MARKS.maxima, 'X', sheetTitle);
        pushUpdate(actualizaciones, EDAD_ROW, EDAD_MARKS.indistinto, 'X', sheetTitle);
    } else {
        pushUpdate(actualizaciones, EDAD_ROW, EDAD_MARKS.minima, p.edadMinima || '', sheetTitle);
        pushUpdate(actualizaciones, EDAD_ROW, EDAD_MARKS.maxima, p.edadMaxima || '', sheetTitle);
        pushUpdate(actualizaciones, EDAD_ROW, EDAD_MARKS.indistinto, '', sheetTitle);
    }
}

function leerOpcionMarcada(ws, row, marks) {
    for (const [key, col] of Object.entries(marks)) {
        if (leerMarca(leerCelda(ws, row, col))) return key;
    }
    return '';
}

function leerEscolaridadDesdeHoja(ws) {
    const esc = sanitizarEscolaridad({});
    Object.entries(ESC_MARKS).forEach(([key, pos]) => {
        if (typeof pos === 'object' && pos.row && pos.col) {
            if (['licText', 'espText', 'maestText'].includes(key)) {
                esc[key] = leerCelda(ws, pos.row, pos.col);
            } else {
                esc[key] = leerMarca(leerCelda(ws, pos.row, pos.col));
            }
        }
    });
    return esc;
}

function leerExperienciaLado(ws, rows, layout) {
    const out = [];
    rows.forEach((row, idx) => {
        const enQue = leerRango(ws, {
            startRow: row,
            endRow: row,
            startCol: layout.enQueStart,
            endCol: layout.enQueEnd
        });
        const tiempo = leerCelda(ws, row, layout.tiempoCol);
        if (enQue || tiempo) {
            out[idx] = sanitizarExpItem({ enQue, tiempo });
        }
    });
    return out.filter(Boolean);
}

function leerRelacionesDesdeHoja(ws, config) {
    const out = [];
    for (let row = config.startRow; row <= config.endRow; row++) {
        const actor = leerRango(ws, {
            startRow: row,
            endRow: row,
            startCol: config.actorStart,
            endCol: config.actorEnd
        });
        const motivo = leerRango(ws, {
            startRow: row,
            endRow: row,
            startCol: config.motivoStart,
            endCol: config.motivoEnd
        });
        if (actor || motivo) out.push(sanitizarRelacion({ actor, motivo }));
    }
    return out;
}

function leerRequerimientosDesdeHoja(ws) {
    const out = {};
    Object.entries(REQ_ROWS).forEach(([key, row]) => {
        out[key] = sanitizarRequerimiento({
            activo: leerMarca(leerCelda(ws, row, REQ_MARK_COL)),
            detalle: leerRango(ws, {
                startRow: row,
                endRow: row,
                startCol: REQ_DETAIL_COL,
                endCol: REQ_DETAIL_COL + 10
            })
        });
    });
    return out;
}

function parsearFuncionesDesdeHoja(ws) {
    const funciones = [];
    for (let row = CELLS.funciones.startRow; row <= CELLS.funciones.endRow; row++) {
        const texto = leerRango(ws, {
            startRow: row,
            endRow: row,
            startCol: CELLS.funciones.startCol,
            endCol: CELLS.funciones.endCol
        });
        if (!texto) continue;
        funciones.push(normalizarSaltos(texto.replace(/^\d+\.\s*/, '')));
    }
    return funciones;
}

function parsearDatosDesdeHoja(ws) {
    const revText = leerCelda(ws, REVISION_CELL.row, REVISION_CELL.col);
    const fechaRevText = leerCelda(ws, FECHA_REV_CELL.row, FECHA_REV_CELL.col);
    const edadData = leerEdadDesdeHoja(ws);
    const perfil = sanitizarPerfil({
        puesto: leerRango(ws, CELLS.puesto),
        areaDepartamento: leerRango(ws, CELLS.areaDepartamento),
        puestoAlQueReporta: leerRango(ws, CELLS.puestoAlQueReporta),
        puestosQueLeReportan: leerRango(ws, CELLS.puestosQueLeReportan),
        objetivo: leerBloqueFilas(ws, CELLS.objetivo),
        funciones: parsearFuncionesDesdeHoja(ws),
        ...edadData,
        sexo: leerOpcionMarcada(ws, SEXO_ROW, SEXO_MARKS),
        estadoCivil: leerOpcionMarcada(ws, ESTADO_CIVIL_ROW, ESTADO_CIVIL_MARKS),
        esc: leerEscolaridadDesdeHoja(ws),
        experienciaIzq: leerExperienciaLado(ws, EXP_DATA_ROWS, EXP_LEFT),
        experienciaDer: [],
        formacionCompetenciasTecnicas: leerBloqueFilas(ws, CELLS.formacion),
        habilidadesBlandas: leerBloqueFilas(ws, CELLS.habilidades),
        conocimientoEquipoOperacion: leerBloqueFilas(ws, CELLS.conocimiento),
        requerimientos: leerRequerimientosDesdeHoja(ws),
        relacionesInternas: leerRelacionesDesdeHoja(ws, REL_INTERNAS),
        relacionesExternas: leerRelacionesDesdeHoja(ws, REL_EXTERNAS)
    });
    return {
        revision: extraerRevision(revText),
        fechaRevision: formatearFechaIso(fechaRevText.replace(/fecha rev\.?\s*:?\s*/i, '')) || DATOS_DEFECTO.fechaRevision,
        perfil
    };
}

function pushOpcionUnica(actualizaciones, row, marks, seleccion, sheetTitle) {
    Object.entries(marks).forEach(([key, col]) => {
        pushUpdate(actualizaciones, row, col, marcaCheckbox(seleccion === key), sheetTitle);
    });
}

function pushEscolaridad(actualizaciones, esc, sheetTitle) {
    const limpio = sanitizarEscolaridad(esc);
    Object.entries(ESC_MARKS).forEach(([key, pos]) => {
        if (!pos?.row || !pos?.col) return;
        if (['licText', 'espText', 'maestText'].includes(key)) {
            pushUpdate(actualizaciones, pos.row, pos.col, limpio[key] || '', sheetTitle);
        } else {
            pushUpdate(actualizaciones, pos.row, pos.col, marcaCheckbox(!!limpio[key]), sheetTitle);
        }
    });
}

function pushBloqueTexto(actualizaciones, config, texto, sheetTitle) {
    const lineas = normalizarSaltos(texto).split('\n');
    const totalFilas = config.endRow - config.startRow + 1;
    for (let i = 0; i < totalFilas; i++) {
        const row = config.startRow + i;
        pushUpdate(actualizaciones, row, config.startCol, lineas[i] || '', sheetTitle);
    }
}

function pushRelaciones(actualizaciones, config, relaciones, sheetTitle) {
    const total = config.endRow - config.startRow + 1;
    for (let i = 0; i < total; i++) {
        const row = config.startRow + i;
        const item = relaciones[i];
        pushUpdate(actualizaciones, row, config.actorStart, item?.actor || '', sheetTitle);
        pushUpdate(actualizaciones, row, config.motivoStart, item?.motivo || '', sheetTitle);
    }
}

function perfilAActualizacionesSheet(perfil, meta, sheetTitle) {
    const p = sanitizarPerfil(perfil);
    const actualizaciones = [];

    pushUpdate(actualizaciones, REVISION_CELL.row, REVISION_CELL.col,
        `Revisión: ${meta.revision || DATOS_DEFECTO.revision}`, sheetTitle);
    pushUpdate(actualizaciones, FECHA_REV_CELL.row, FECHA_REV_CELL.col,
        `Fecha Rev.: ${formatearFechaDisplay(meta.fechaRevision)}`, sheetTitle);

    pushUpdate(actualizaciones, CELLS.puesto.row, CELLS.puesto.startCol, p.puesto, sheetTitle);
    pushUpdate(actualizaciones, CELLS.areaDepartamento.row, CELLS.areaDepartamento.startCol, p.areaDepartamento, sheetTitle);
    pushUpdate(actualizaciones, CELLS.puestoAlQueReporta.row, CELLS.puestoAlQueReporta.startCol, p.puestoAlQueReporta, sheetTitle);
    pushUpdate(actualizaciones, CELLS.puestosQueLeReportan.row, CELLS.puestosQueLeReportan.startCol, p.puestosQueLeReportan, sheetTitle);

    pushBloqueTexto(actualizaciones, CELLS.objetivo, p.objetivo, sheetTitle);

    for (let i = 0; i < MAX_FUNCIONES; i++) {
        const row = CELLS.funciones.startRow + i;
        const texto = p.funciones[i];
        pushUpdate(actualizaciones, row, CELLS.funciones.startCol,
            texto ? `${i + 1}. ${texto}` : '', sheetTitle);
    }

    pushEdad(actualizaciones, p, sheetTitle);
    pushOpcionUnica(actualizaciones, SEXO_ROW, SEXO_MARKS, p.sexo, sheetTitle);
    pushOpcionUnica(actualizaciones, ESTADO_CIVIL_ROW, ESTADO_CIVIL_MARKS, p.estadoCivil, sheetTitle);
    pushEscolaridad(actualizaciones, p.esc, sheetTitle);

    const expList = Array.isArray(p.experiencias) && p.experiencias.length
        ? p.experiencias
        : (Array.isArray(p.experienciaIzq) ? p.experienciaIzq : []);
    EXP_DATA_ROWS.forEach((row, idx) => {
        const item = sanitizarExpItem(expList[idx] || EXP_ITEM_DEFECTO());
        pushUpdate(actualizaciones, row, EXP_LEFT.enQueStart, item.enQue || '', sheetTitle);
        pushUpdate(actualizaciones, row, EXP_LEFT.tiempoCol, item.tiempo || '', sheetTitle);
    });

    pushBloqueTexto(actualizaciones, CELLS.formacion, p.formacionCompetenciasTecnicas, sheetTitle);
    pushBloqueTexto(actualizaciones, CELLS.habilidades, p.habilidadesBlandas, sheetTitle);
    pushBloqueTexto(actualizaciones, CELLS.conocimiento, p.conocimientoEquipoOperacion, sheetTitle);

    Object.entries(REQ_ROWS).forEach(([key, row]) => {
        const req = p.requerimientos?.[key] || REQUERIMIENTO_DEFECTO();
        pushUpdate(actualizaciones, row, REQ_MARK_COL, marcaCheckbox(req.activo), sheetTitle);
        pushUpdate(actualizaciones, row, REQ_DETAIL_COL, req.detalle || '', sheetTitle);
    });

    pushRelaciones(actualizaciones, REL_INTERNAS, p.relacionesInternas, sheetTitle);
    pushRelaciones(actualizaciones, REL_EXTERNAS, p.relacionesExternas, sheetTitle);

    return actualizaciones;
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

async function obtenerWorksheet(buffer, sheetTitle) {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buffer);
    if (sheetTitle) {
        const hit = wb.getWorksheet(sheetTitle) || wb.worksheets.find(
            (w) => String(w.name || '').trim() === String(sheetTitle).trim()
        );
        if (hit) return hit;
    }
    return wb.getWorksheet(SHEET_TITLE) || wb.worksheets[0] || null;
}

async function resolverTituloPlantilla(spreadsheetId) {
    const titulos = await driveService.listarHojasGoogleSheet(spreadsheetId);
    return driveService.resolverTituloHojaExistente(titulos, SHEET_TITLE, { fallbackRegex: /plantilla/i })
        || SHEET_TITLE
        || (titulos || [])[0]
        || SHEET_TITLE;
}

async function escribirPerfilEnHoja(spreadsheetId, sheetTitle, perfil, meta) {
    const actualizaciones = perfilAActualizacionesSheet(perfil, meta, sheetTitle);
    const CHUNK = 200;
    for (let i = 0; i < actualizaciones.length; i += CHUNK) {
        await driveService.actualizarCeldasGoogleSheet(spreadsheetId, actualizaciones.slice(i, i + CHUNK));
    }
    return spreadsheetId;
}

async function recrearHojaPerfil(spreadsheetId, nombreHoja, perfil, meta) {
    const titulos = await driveService.listarHojasGoogleSheet(spreadsheetId);
    if (titulos.includes(nombreHoja)) {
        try {
            await driveService.eliminarHojasGoogleSheet(spreadsheetId, [nombreHoja]);
        } catch (err) {
            console.warn(`[ATH-F-02] No se pudo eliminar hoja previa ${nombreHoja}:`, err.message);
        }
    }
    const origen = await resolverTituloPlantilla(spreadsheetId);
    const dup = await driveService.duplicarHojaGoogleSheet(spreadsheetId, origen, nombreHoja);
    const tituloFinal = dup.title || nombreHoja;
    await escribirPerfilEnHoja(spreadsheetId, tituloFinal, perfil, meta);
    return { titulo: tituloFinal, driveFileId: spreadsheetId };
}

async function sincronizarHojasPerfilesEnDrive(spreadsheetId, datos, datosPrevios = null) {
    const meta = sanitizarDatos(datos);
    const prev = datosPrevios ? sanitizarDatos(datosPrevios) : null;
    let driveIdActual = spreadsheetId;
    const titulosExistentes = await driveService.listarHojasGoogleSheet(driveIdActual);
    const setExistentes = new Set(titulosExistentes);
    const plantillaOrigen = await resolverTituloPlantilla(driveIdActual);

    const mapaIdHojaPrevio = new Map();
    if (prev?.perfiles) {
        for (const p of prev.perfiles) {
            const almacenado = sanitizarNombreHoja(p.nombreHoja);
            mapaIdHojaPrevio.set(p.id, almacenado || resolverNombreHojaPerfil(p));
        }
    }

    const hojasActivas = new Set();
    const perfilesOut = [];

    for (const perfil of meta.perfiles) {
        if (!perfilTieneContenido(perfil)) {
            perfilesOut.push({ ...perfil });
            continue;
        }

        let nombreHoja = resolverNombreHojaPerfil(perfil);
        const hojaPrev = mapaIdHojaPrevio.get(perfil.id);
        if (hojaPrev && hojaPrev !== nombreHoja && setExistentes.has(hojaPrev)) {
            try {
                const ren = await driveService.renombrarHojaGoogleSheet(driveIdActual, hojaPrev, nombreHoja);
                nombreHoja = ren?.title || nombreHoja;
                setExistentes.delete(hojaPrev);
                setExistentes.add(nombreHoja);
            } catch (err) {
                try {
                    await driveService.eliminarHojasGoogleSheet(driveIdActual, [hojaPrev]);
                    setExistentes.delete(hojaPrev);
                } catch (err2) {
                    console.warn(`[ATH-F-02] No se pudo eliminar hoja previa ${hojaPrev}:`, err2.message);
                }
            }
        }

        try {
            if (setExistentes.has(nombreHoja)) {
                await escribirPerfilEnHoja(driveIdActual, nombreHoja, perfil, meta);
            } else {
                const creada = await recrearHojaPerfil(driveIdActual, nombreHoja, perfil, meta);
                nombreHoja = creada.titulo;
                setExistentes.add(nombreHoja);
            }
            hojasActivas.add(nombreHoja);
            perfilesOut.push({ ...perfil, nombreHoja });
        } catch (err) {
            console.warn(`[ATH-F-02] No se pudo sincronizar hoja "${nombreHoja}":`, err.message);
            perfilesOut.push(perfil);
        }
    }

    const eliminar = [];
    for (const titulo of titulosExistentes) {
        if (titulo === SHEET_TITLE || titulo === plantillaOrigen) continue;
        if (esHojaPerfilAthF02(titulo) && !hojasActivas.has(titulo)) {
            eliminar.push(titulo);
        }
    }
    if (eliminar.length) {
        try {
            await driveService.eliminarHojasGoogleSheet(driveIdActual, eliminar);
        } catch (err) {
            console.warn('[ATH-F-02] No se pudieron eliminar hojas obsoletas:', err.message);
        }
    }

    return { datos: { ...meta, perfiles: perfilesOut }, driveFileId: driveIdActual };
}

async function esSpreadsheetEditableEnDrive(fileId) {
    try {
        const info = await driveService.obtenerInfoArchivo(fileId);
        return String(info?.mimeType || '') === 'application/vnd.google-apps.spreadsheet';
    } catch {
        return false;
    }
}

function esIdPlantillaMaestra(fileId) {
    return String(fileId || '').trim() === PLANTILLA_XLSX_DRIVE_ID;
}

async function buscarArchivoDriveTrabajo() {
    const archivos = await driveService.listarArchivosCarpeta(CARPETA_DRIVE_ID);
    const objetivo = NOMBRE_ARCHIVO_DRIVE.toLowerCase();
    return (archivos || [])
        .filter((f) => String(f.name || '').toLowerCase().startsWith(objetivo)
            || String(f.id || '') === DRIVE_FILE_ID_SISTEMA)
        .sort((a, b) => new Date(b.modifiedTime || 0) - new Date(a.modifiedTime || 0))[0] || null;
}

async function resolverDriveFileId(registro) {
    if (DRIVE_FILE_ID_SISTEMA) {
        try {
            const existe = await driveService.verificarArchivoExiste(DRIVE_FILE_ID_SISTEMA);
            if (existe && await esSpreadsheetEditableEnDrive(DRIVE_FILE_ID_SISTEMA)) {
                return DRIVE_FILE_ID_SISTEMA;
            }
        } catch {
            // continuar con otros candidatos
        }
    }

    const candidatos = [];
    const agregar = (id) => {
        const val = String(id || '').trim();
        if (val && !candidatos.includes(val)) candidatos.push(val);
    };
    agregar(registro?.drive_file_id);
    const enCarpeta = await buscarArchivoDriveTrabajo().catch(() => null);
    agregar(enCarpeta?.id);
    for (const id of candidatos) {
        if (esIdPlantillaMaestra(id)) continue;
        try {
            if (await driveService.verificarArchivoExiste(id) && await esSpreadsheetEditableEnDrive(id)) {
                return id;
            }
        } catch {
            continue;
        }
    }
    return enCarpeta?.id || null;
}

async function crearCopiaPlantillaEnCarpeta(pool, registro = null) {
    const existePlantilla = await driveService.verificarArchivoExiste(PLANTILLA_XLSX_DRIVE_ID).catch(() => false);
    if (!existePlantilla) {
        throw new Error(
            'Plantilla ATH-F-02 no encontrada en Drive. Compártela con la cuenta del sistema como Editor.'
        );
    }
    const buffer = await driveService.descargarArchivo(PLANTILLA_XLSX_DRIVE_ID);
    const copia = await driveService.subirExcelComoGoogleSheet(
        buffer,
        NOMBRE_ARCHIVO_DRIVE,
        CARPETA_DRIVE_ID,
        { sheetTitle: SHEET_TITLE, maxColumns: 30, keepSingleSheet: false }
    );
    if (pool && copia?.id && registro) {
        await guardarRegistroDb(pool, {
            driveFileId: copia.id,
            datos: (await leerDatosRegistro(registro)) || sanitizarDatos(DATOS_DEFECTO),
            fechaElaboracionOriginal: registro?.fecha_elaboracion_original,
            fechaModificacionContenido: registro?.fecha_modificacion_contenido,
            contenidoModificado: !!registro?.contenido_modificado
        });
    }
    return copia;
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
    if (dbVal != null && dbVal !== '') return formatearDatetimeMysqlMexico(dbVal);
    const driveVal = archivoDrive?.modifiedTime;
    if (driveVal) return formatearDatetimeMysqlMexico(driveVal);
    return null;
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
    await persistirRegistroSgc(pool, CODIGO_FORMATO, payload);
}

async function construirRespuesta(registro, datos, archivoDrive, opciones = {}) {
    const fechaOriginal = formatearFechaIso(registro?.fecha_elaboracion_original);
    const fechaMod = formatearFechaIso(registro?.fecha_modificacion_contenido);
    const modificado = !!registro?.contenido_modificado;
    const fechaMostrar = modificado && fechaMod ? fechaMod : (fechaOriginal || datos.fechaElaboracion);
    const driveId = archivoDrive?.id || registro?.drive_file_id || null;

    let editorUrl = driveId ? `https://docs.google.com/spreadsheets/d/${driveId}/edit?usp=sharing` : null;
    let previewUrl = driveId ? `https://docs.google.com/spreadsheets/d/${driveId}/preview` : null;
    const hojaEditor = opciones.hojaEditor || resolverNombreHojaPerfil(resolverPerfilActivo(datos));

    if (driveId && hojaEditor && hojaEditor !== 'Sin-nombre') {
        try {
            const gid = await driveService.obtenerGidHojaPorNombre(driveId, hojaEditor);
            if (gid != null) {
                editorUrl = driveService.construirUrlEditorGoogleSheet(driveId, { gid });
                previewUrl = driveService.construirUrlEditorGoogleSheet(driveId, { gid, modo: 'preview' });
            }
        } catch (err) {
            console.warn('[ATH-F-02] No se pudo resolver gid de hoja editor:', err.message);
        }
    }

    return {
        codigo: CODIGO_FORMATO,
        datos: { ...datos, fechaElaboracion: fechaMostrar },
        fechaElaboracionOriginal: fechaOriginal || datos.fechaElaboracion,
        fechaModificacionContenido: fechaMod || null,
        contenidoModificado: modificado,
        driveFileId: driveId,
        editorUrl,
        previewUrl,
        ultimaSyncDrive: formatearUltimaSyncDisplay(registro, archivoDrive),
        hojaEditor
    };
}

async function cargarFormato(pool) {
    await asegurarTablaSgcFormatoDatos(pool);
    let registro = await obtenerRegistroDb(pool);
    const datosDb = await leerDatosRegistro(registro);
    let datos = datosDb || sanitizarDatos(DATOS_DEFECTO);

    let driveFileId = await resolverDriveFileId(registro);
    if (driveFileId && driveFileId !== registro?.drive_file_id) {
        await guardarRegistroDb(pool, {
            driveFileId,
            datos,
            fechaElaboracionOriginal: registro?.fecha_elaboracion_original,
            fechaModificacionContenido: registro?.fecha_modificacion_contenido,
            contenidoModificado: !!registro?.contenido_modificado
        });
        registro = await obtenerRegistroDb(pool);
    }

    let archivoDrive = null;
    if (driveFileId) {
        archivoDrive = await driveService.obtenerInfoArchivo(driveFileId).catch(() => ({ id: driveFileId }));
    } else {
        try {
            const copia = await crearCopiaPlantillaEnCarpeta(pool, registro);
            driveFileId = copia.id;
            archivoDrive = await driveService.obtenerInfoArchivo(driveFileId).catch(() => copia);
            await guardarRegistroDb(pool, {
                driveFileId,
                datos,
                fechaElaboracionOriginal: registro?.fecha_elaboracion_original || datos.fechaElaboracion,
                fechaModificacionContenido: registro?.fecha_modificacion_contenido,
                contenidoModificado: !!registro?.contenido_modificado
            });
            registro = await obtenerRegistroDb(pool);
        } catch (err) {
            console.warn('[ATH-F-02] No se pudo crear documento (sistema) en Drive al cargar:', err.message);
        }
    }

    registro = { ...(registro || {}), drive_file_id: driveFileId || null };
    return construirRespuesta(registro, datos, archivoDrive, {
        hojaEditor: resolverNombreHojaPerfil(resolverPerfilActivo(datos))
    });
}

async function guardarFormato(pool, body, options = {}) {
    await asegurarTablaSgcFormatoDatos(pool);
    const editorActivo = !!body?.editorActivo || !!options.editorActivo;
    if (editorActivo) {
        return sincronizarDesdeDrive(pool);
    }

    const registroPrevio = await obtenerRegistroDb(pool);
    const datosEntrada = sanitizarDatos(body?.datos || body);
    const origen = String(body?.origen || 'sistema').toLowerCase();

    let fechaOriginal = formatearFechaIso(registroPrevio?.fecha_elaboracion_original);
    let contenidoModificado = !!registroPrevio?.contenido_modificado;
    let fechaModificacion = formatearFechaIso(registroPrevio?.fecha_modificacion_contenido);
    if (!fechaOriginal) {
        fechaOriginal = datosEntrada.fechaElaboracion || DATOS_DEFECTO.fechaElaboracion;
    }

    const datosPrevios = await leerDatosRegistro(registroPrevio);
    const huboCambio = !datosPrevios || !contenidoEsEquivalente(datosPrevios, datosEntrada);
    let driveId = await resolverDriveFileId(registroPrevio);

    if (huboCambio && origen !== 'consulta') {
        contenidoModificado = true;
        fechaModificacion = excelHistorial.fechaAhoraMexicoIso();
    }

    const datosGuardar = {
        ...datosEntrada,
        fechaElaboracion: contenidoModificado && fechaModificacion ? fechaModificacion : fechaOriginal
    };

    if (!driveId) {
        try {
            const copia = await crearCopiaPlantillaEnCarpeta(pool, registroPrevio);
            driveId = copia.id;
        } catch (err) {
            console.warn('[ATH-F-02] No se pudo crear copia de plantilla:', err.message);
        }
    }

    if (driveId && (await esSpreadsheetEditableEnDrive(driveId))) {
        try {
            const sync = await sincronizarHojasPerfilesEnDrive(driveId, datosGuardar, datosPrevios);
            Object.assign(datosGuardar, sync.datos);
            if (sync.driveFileId) driveId = sync.driveFileId;
        } catch (err) {
            console.warn('[ATH-F-02] No se pudo actualizar Google Sheet:', err.message);
        }
    }

    await guardarRegistroDb(pool, {
        driveFileId: driveId,
        datos: datosGuardar,
        fechaElaboracionOriginal: fechaOriginal,
        fechaModificacionContenido: contenidoModificado ? fechaModificacion : null,
        contenidoModificado
    });

    const registro = await obtenerRegistroDb(pool);
    const archivoDrive = driveId
        ? await driveService.obtenerInfoArchivo(driveId).catch(() => ({ id: driveId }))
        : null;
    return construirRespuesta(registro, datosGuardar, archivoDrive, {
        hojaEditor: resolverNombreHojaPerfil(resolverPerfilActivo(datosGuardar))
    });
}

async function sincronizarDesdeDrive(pool) {
    await asegurarTablaSgcFormatoDatos(pool);
    const registro = await obtenerRegistroDb(pool);
    const driveFileId = await resolverDriveFileId(registro);
    if (!driveFileId) return cargarFormato(pool);

    const datosDb = await leerDatosRegistro(registro) || sanitizarDatos(DATOS_DEFECTO);
    const titulos = await driveService.listarHojasGoogleSheet(driveFileId);
    const plantilla = await resolverTituloPlantilla(driveFileId);
    const perfiles = [];
    const buffer = await descargarBufferDrive(driveFileId);

    for (const titulo of titulos || []) {
        if (titulo === plantilla || /^plantilla$/i.test(String(titulo).trim())) continue;
        if (!esHojaPerfilAthF02(titulo)) continue;
        try {
            const ws = await obtenerWorksheet(buffer, titulo);
            if (!ws) continue;
            const parsed = parsearDatosDesdeHoja(ws);
            const perfil = {
                ...parsed.perfil,
                nombreHoja: titulo
            };
            const prev = (datosDb.perfiles || []).find(
                (p) => p.nombreHoja === titulo || resolverNombreHojaPerfil(p) === titulo
            );
            if (prev) {
                perfil.id = prev.id;
                perfil.pdfFirmado = prev.pdfFirmado || perfil.pdfFirmado;
            } else {
                perfil.id = perfil.id || nuevoId();
            }
            if (perfilTieneContenido(perfil)) perfiles.push(sanitizarPerfil(perfil));
        } catch (err) {
            console.warn(`[ATH-F-02] No se pudo leer hoja "${titulo}":`, err.message);
        }
    }

    const metaBase = {
        revision: datosDb.revision,
        fechaRevision: datosDb.fechaRevision,
        fechaElaboracion: datosDb.fechaElaboracion,
        perfilActivoId: datosDb.perfilActivoId
    };

    if (perfiles.length) {
        const first = parsearDatosDesdeHoja(await obtenerWorksheet(buffer, plantilla));
        if (first?.revision) metaBase.revision = first.revision;
        if (first?.fechaRevision) metaBase.fechaRevision = first.fechaRevision;
    }

    const datos = sanitizarDatos({
        ...metaBase,
        perfiles: perfiles.length ? perfiles : datosDb.perfiles
    });

    await guardarRegistroDb(pool, {
        driveFileId,
        datos,
        fechaElaboracionOriginal: registro?.fecha_elaboracion_original,
        fechaModificacionContenido: registro?.fecha_modificacion_contenido,
        contenidoModificado: !!registro?.contenido_modificado
    });

    const registroFinal = await obtenerRegistroDb(pool);
    const archivoDrive = await driveService.obtenerInfoArchivo(driveFileId).catch(() => ({ id: driveFileId }));
    return construirRespuesta(registroFinal, datos, archivoDrive, {
        hojaEditor: resolverNombreHojaPerfil(resolverPerfilActivo(datos))
    });
}

async function actualizarPlantillaDesdeSistema(pool) {
    await asegurarTablaSgcFormatoDatos(pool);
    const registro = await obtenerRegistroDb(pool);
    const datos = (await leerDatosRegistro(registro)) || sanitizarDatos(DATOS_DEFECTO);
    const fechaOriginal = formatearFechaIso(registro?.fecha_elaboracion_original) || datos.fechaElaboracion;
    const contenidoModificado = !!registro?.contenido_modificado;
    const fechaModificacion = formatearFechaIso(registro?.fecha_modificacion_contenido);

    if (registro?.drive_file_id && !esIdPlantillaMaestra(registro.drive_file_id)) {
        try {
            await driveService.eliminarArchivo(registro.drive_file_id);
        } catch (err) {
            console.warn('[ATH-F-02] Archivo previo no encontrado al actualizar plantilla:', err.message);
        }
    }

    let driveId = null;
    let archivoDrive = null;
    try {
        const copia = await crearCopiaPlantillaEnCarpeta(pool, registro);
        driveId = copia.id;
        await sincronizarHojasPerfilesEnDrive(driveId, datos, null);
        archivoDrive = await driveService.obtenerInfoArchivo(driveId).catch(() => copia);
    } catch (err) {
        console.warn('[ATH-F-02] Drive no disponible al actualizar plantilla:', err.message);
    }

    await guardarRegistroDb(pool, {
        driveFileId: driveId,
        datos: {
            ...datos,
            fechaElaboracion: contenidoModificado && fechaModificacion ? fechaModificacion : fechaOriginal
        },
        fechaElaboracionOriginal: fechaOriginal,
        fechaModificacionContenido: contenidoModificado ? fechaModificacion : null,
        contenidoModificado
    });

    const registroFinal = await obtenerRegistroDb(pool);
    return construirRespuesta(registroFinal, datos, archivoDrive, {
        hojaEditor: resolverNombreHojaPerfil(resolverPerfilActivo(datos))
    });
}

function nombrePdfFirmado(puesto = '') {
    const tag = String(puesto || 'sin-puesto')
        .replace(/[/\\?*:[\]]/g, '_')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 80) || 'sin-puesto';
    return `ATH-F-02 ${tag} firmado.pdf`;
}

async function publicarPdfEnDrive(pdfBuffer, puesto) {
    return driveService.subirArchivoNuevo(
        pdfBuffer,
        nombrePdfFirmado(puesto),
        'application/pdf',
        CARPETA_PDF_FIRMADOS_ID
    );
}

async function subirPdfFirmado(pool, body) {
    const pdfBase64 = String(body?.pdf_base64 || body?.pdfBase64 || '').trim();
    if (!pdfBase64) throw new Error('No se recibió el PDF (pdf_base64 requerido).');
    const perfilId = String(body?.perfilId || body?.perfil_id || '').trim();
    if (!perfilId) throw new Error('Se requiere perfilId para asociar el PDF firmado.');

    const pdfBuffer = Buffer.from(pdfBase64.replace(/^data:[^;]+;base64,/, ''), 'base64');
    if (!pdfBuffer.length) throw new Error('El archivo PDF está vacío.');

    await asegurarTablaSgcFormatoDatos(pool);
    const registroPrevio = await obtenerRegistroDb(pool);
    const datosPrevios = (await leerDatosRegistro(registroPrevio)) || sanitizarDatos(DATOS_DEFECTO);
    const perfiles = Array.isArray(datosPrevios.perfiles) ? [...datosPrevios.perfiles] : [];
    const idx = perfiles.findIndex((p) => p.id === perfilId);
    if (idx < 0) {
        throw new Error('No se encontró el perfil indicado en el archivero.');
    }

    const driveResult = await publicarPdfEnDrive(pdfBuffer, perfiles[idx].puesto);
    const pdfFirmado = sanitizarPdfFirmado({
        driveFileId: driveResult.id,
        nombreArchivo: driveResult.name || nombrePdfFirmado(perfiles[idx].puesto),
        webViewLink: driveResult.webViewLink || null,
        fechaSubida: fechaHoyIso()
    });

    perfiles[idx] = { ...perfiles[idx], pdfFirmado };
    const datosGuardar = sanitizarDatos({
        ...datosPrevios,
        perfiles,
        perfilActivoId: perfilId
    });

    await guardarRegistroDb(pool, {
        driveFileId: registroPrevio?.drive_file_id || null,
        datos: datosGuardar,
        fechaElaboracionOriginal: formatearFechaIso(registroPrevio?.fecha_elaboracion_original) || fechaHoyIso(),
        fechaModificacionContenido: excelHistorial.fechaAhoraMexicoIso(),
        contenidoModificado: true
    });

    const registro = await obtenerRegistroDb(pool);
    const archivoDrive = registro?.drive_file_id
        ? await driveService.obtenerInfoArchivo(registro.drive_file_id).catch(() => ({ id: registro.drive_file_id }))
        : null;
    const respuesta = await construirRespuesta(registro, datosGuardar, archivoDrive, {
        hojaEditor: resolverNombreHojaPerfil(resolverPerfilActivo(datosGuardar))
    });
    return { ...respuesta, pdfFirmado };
}

module.exports = {
    CODIGO_FORMATO,
    TEMPLATE_DRIVE_ID,
    CARPETA_DRIVE_ID,
    CARPETA_PDF_FIRMADOS_ID,
    DATOS_DEFECTO,
    cargarFormato,
    guardarFormato,
    sincronizarDesdeDrive,
    actualizarPlantillaDesdeSistema,
    subirPdfFirmado,
    sanitizarDatos,
    sanitizarPerfil,
    crearPerfilVacio,
    resolverPerfilActivo,
    perfilTieneContenido,
    resolverNombreHojaPerfil
};
