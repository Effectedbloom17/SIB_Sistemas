/**
 * Notas de versión (novedades entre releases).
 * - En desarrollo se acumulan en "borrador".
 * - Al publicar / desplegar, el borrador pasa a "historial" con la versión actual
 *   y el borrador queda vacío para la siguiente iteración.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const FILE_PATH = path.join(__dirname, 'data', 'notas-version.json');

const ICONOS_PERMITIDOS = new Set([
    'fa-newspaper',
    'fa-desktop',
    'fa-chart-bar',
    'fa-paint-brush',
    'fa-cogs',
    'fa-mobile-alt',
    'fa-shield-alt',
    'fa-folder-open',
    'fa-user-check',
    'fa-bolt',
    'fa-wrench',
    'fa-star',
    'fa-database',
    'fa-lightbulb',
    'fa-ticket-alt'
]);

function emptyData() {
    return { activo: false, borrador: [], historial: [] };
}

function ensureFile() {
    const dir = path.dirname(FILE_PATH);
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
    if (!fs.existsSync(FILE_PATH)) {
        writeData(emptyData());
    }
}

function readData() {
    ensureFile();
    try {
        const raw = fs.readFileSync(FILE_PATH, 'utf8');
        const parsed = JSON.parse(raw);
        return {
            activo: Boolean(parsed.activo),
            borrador: Array.isArray(parsed.borrador) ? parsed.borrador : [],
            historial: Array.isArray(parsed.historial) ? parsed.historial : []
        };
    } catch (error) {
        console.error('[NOTAS-VERSION] Error leyendo archivo:', error?.message || error);
        return emptyData();
    }
}

function writeData(data) {
    ensureFile();
    const payload = {
        activo: Boolean(data.activo),
        borrador: Array.isArray(data.borrador) ? data.borrador : [],
        historial: Array.isArray(data.historial) ? data.historial : []
    };
    fs.writeFileSync(FILE_PATH, JSON.stringify(payload, null, 2) + '\n', 'utf8');
    return payload;
}

function esEntornoEditable() {
    return process.env.NODE_ENV !== 'production';
}

function normalizarTexto(valor, maxLen) {
    const texto = String(valor || '').trim().replace(/\s+/g, ' ');
    if (!texto) {
        return '';
    }
    return texto.slice(0, maxLen);
}

function normalizarIcono(icono) {
    const valor = String(icono || '').trim();
    if (ICONOS_PERMITIDOS.has(valor)) {
        return valor;
    }
    return 'fa-newspaper';
}

function crearId() {
    return `nv-${Date.now().toString(36)}-${crypto.randomBytes(3).toString('hex')}`;
}

function listar({ incluirBorrador, puedeActivar }) {
    const data = readData();
    // Sistema siempre activo para notificaciones / aportaciones.
    const activo = true;
    const visibleParaUsuario = true;
    return {
        activo,
        borrador: visibleParaUsuario && incluirBorrador ? data.borrador : [],
        historial: visibleParaUsuario ? data.historial : [],
        puedeEditar: Boolean(incluirBorrador && esEntornoEditable()),
        puedeActivar: false
    };
}

/** Activa o desactiva el sistema de novedades de forma manual. */
function setActivo(activo) {
    const data = readData();
    data.activo = Boolean(activo);
    writeData(data);
    return data.activo;
}

function agregarBorrador({ titulo, descripcion, icono }) {
    if (!esEntornoEditable()) {
        const error = new Error('Las notas de desarrollo solo se editan fuera de producción');
        error.status = 403;
        throw error;
    }

    const tituloLimpio = normalizarTexto(titulo, 120);
    const descripcionLimpia = normalizarTexto(descripcion, 280);
    if (!tituloLimpio || !descripcionLimpia) {
        const error = new Error('Título y descripción son obligatorios');
        error.status = 400;
        throw error;
    }

    const data = readData();
    const nota = {
        id: crearId(),
        titulo: tituloLimpio,
        descripcion: descripcionLimpia,
        icono: normalizarIcono(icono)
    };
    data.borrador.unshift(nota);
    writeData(data);
    return nota;
}

function eliminarBorrador(id) {
    if (!esEntornoEditable()) {
        const error = new Error('Las notas de desarrollo solo se editan fuera de producción');
        error.status = 403;
        throw error;
    }

    const notaId = String(id || '').trim();
    if (!notaId) {
        const error = new Error('ID de nota requerido');
        error.status = 400;
        throw error;
    }

    const data = readData();
    const antes = data.borrador.length;
    data.borrador = data.borrador.filter((n) => n.id !== notaId);
    if (data.borrador.length === antes) {
        const error = new Error('Nota no encontrada en borrador');
        error.status = 404;
        throw error;
    }
    writeData(data);
    return true;
}

/**
 * Publica el borrador bajo la versión indicada y lo vacía.
 * Si ya existe un bloque para esa versión, antepone las notas nuevas.
 */
function publicar(version) {
    const versionLimpia = String(version || '').trim().replace(/^v/i, '');
    if (!/^\d+\.\d+\.\d+/.test(versionLimpia)) {
        const error = new Error('Versión inválida (se espera semver, ej. 3.101.1)');
        error.status = 400;
        throw error;
    }

    const data = readData();
    if (!data.borrador.length) {
        return {
            publicados: 0,
            version: versionLimpia,
            data
        };
    }

    const notasPublicadas = data.borrador.map((n) => ({
        id: n.id,
        titulo: n.titulo,
        descripcion: n.descripcion,
        icono: normalizarIcono(n.icono)
    }));

    const fecha = new Date().toISOString().slice(0, 10);
    const existente = data.historial.find((h) => h.version === versionLimpia);
    if (existente) {
        existente.notas = [...notasPublicadas, ...(existente.notas || [])];
        existente.fecha = fecha;
    } else {
        data.historial.unshift({
            version: versionLimpia,
            fecha,
            notas: notasPublicadas
        });
    }

    data.borrador = [];
    writeData(data);

    return {
        publicados: notasPublicadas.length,
        version: versionLimpia,
        data
    };
}

module.exports = {
    FILE_PATH,
    ICONOS_PERMITIDOS: [...ICONOS_PERMITIDOS],
    esEntornoEditable,
    listar,
    setActivo,
    agregarBorrador,
    eliminarBorrador,
    publicar,
    readData
};
