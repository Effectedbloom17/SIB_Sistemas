// =====================================================
// BIZNAGA R&T — Seguridad · Catálogo de normativas (BD normativas)
// Importación desde plantillas Excel (NOM-001 clásico y variantes tipo NOM-023)
// =====================================================

const ExcelJS = require('exceljs');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const DIR_PORTADAS = path.join(__dirname, 'uploads', 'normativas', 'portadas');
const DIR_FORMATOS = path.join(__dirname, 'uploads', 'normativas', 'formatos');
const DIR_REFERENCIAS = path.join(__dirname, 'uploads', 'normativas', 'referencias');
const MAX_IMAGENES_REFERENCIA = 8;
const EXT_IMAGEN = { '.jpg': '.jpg', '.jpeg': '.jpg', '.png': '.png', '.webp': '.webp' };
const EXT_FORMATO = { '.pdf': '.pdf', '.doc': '.doc', '.docx': '.docx', '.xls': '.xls', '.xlsx': '.xlsx' };

/** Layout clásico NOM-001 (Ítem | Punto | Descripción | …). */
const COL_CLASICO = {
    ITEM: 1,
    PUNTO: 2,
    DESCRIPCION: 3,
    APLICA: 4,
    TIPO_EVIDENCIA: 5,
    PERIODICIDAD: 6,
    PREV_CONSERVAR: 7,
    PREV_MEJORAR: 8,
    PREV_ACTUALIZAR: 9,
    CORR_COMPLEMENTAR: 10,
    CORR_CORREGIR: 11,
    CORR_REALIZAR: 12,
    FECHA_INICIO: 13,
    FECHA_TERMINACION: 14,
    RESPONSABLE: 15,
    INDICADOR_AVANCE: 16,
    EVIDENCIA_REQUERIDA: 17,
    OBSERVACIONES: 18
};

/** NOM-023 u otras: Descripción (A–C) | Aplica | DOCUMENTAL | … sin Ítem/Punto. */
const COL_SOLO_DESCRIPCION = {
    ITEM: null,
    PUNTO: null,
    DESCRIPCION: 1,
    APLICA: 4,
    TIPO_EVIDENCIA: 5,
    PERIODICIDAD: 6,
    PREV_CONSERVAR: 7,
    PREV_MEJORAR: 8,
    PREV_ACTUALIZAR: 9,
    CORR_COMPLEMENTAR: 10,
    CORR_CORREGIR: 11,
    CORR_REALIZAR: 12,
    FECHA_INICIO: 13,
    FECHA_TERMINACION: 14,
    RESPONSABLE: 15,
    INDICADOR_AVANCE: 16,
    EVIDENCIA_REQUERIDA: 17,
    OBSERVACIONES: 18
};

const FILA_INICIO_DATOS_DEFAULT = 5;
const MAX_FILAS_BUSCAR_NOM = 15;
const MAX_COLS_ESCANEO = 30;

/** Acepta NOM-001-STPS-2008 y variantes NOM-036-1-STPS-2018. */
const RE_NOM = /NOM[\s\-–—−‑]*(\d{1,3})(?:[\s\-–—−‑]+(\d+))?[\s\-–—−‑]+([A-Z0-9]+)[\s\-–—−‑]+(\d{4})/i;

function escapeHtml(text) {
    return String(text || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

function extraerTextoCrudo(value) {
    if (value === null || value === undefined) return '';
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return String(value);
    if (value instanceof Date) return value.toISOString().slice(0, 10);
    if (typeof value === 'object') {
        if (Array.isArray(value.richText)) {
            return value.richText.map((p) => p.text || '').join('');
        }
        if (value.text) return extraerTextoCrudo(value.text);
        if (value.result !== undefined && value.result !== null) return extraerTextoCrudo(value.result);
        if (value.hyperlink && value.text) return extraerTextoCrudo(value.text);
    }
    return String(value);
}

function limpiarTexto(value) {
    return extraerTextoCrudo(value).replace(/\s+/g, ' ').trim();
}

/** Conserva los Enter del Excel y aplana solo espacios horizontales de cada línea. */
function textoConSaltos(value) {
    return extraerTextoCrudo(value)
        .replace(/\r\n/g, '\n')
        .replace(/\r/g, '\n')
        .split('\n')
        .map((linea) => linea.replace(/[ \t\u00a0]+/g, ' ').trim())
        .join('\n')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
}

function htmlConSaltos(fragmento) {
    return String(fragmento || '').replace(/\n/g, '<br>').replace(/(?:<br>\s*){3,}/gi, '<br><br>');
}

/** Resalta a), b), c)… al inicio de cada renglón. */
function marcarIncisosHtml(html) {
    return String(html || '').replace(
        /(^|<br\s*\/?>)(\s*)([a-zA-Z]\))/gi,
        '$1$2<strong>$3</strong>'
    );
}

function htmlDesdeDescripcion(texto) {
    return marcarIncisosHtml(htmlConSaltos(escapeHtml(texto)));
}

function sanitizarHtmlDescripcion(html) {
    return String(html || '')
        .replace(/<script[\s\S]*?<\/script>/gi, '')
        .replace(/<style[\s\S]*?<\/style>/gi, '')
        .replace(/\son\w+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '')
        .replace(/<\/?([a-z0-9]+)(?:\s[^>]*)?>/gi, (full, tag) => {
            const t = String(tag).toLowerCase();
            if (t === 'br') return '<br>';
            if (t === 'strong' || t === 'b') return full.startsWith('</') ? '</strong>' : '<strong>';
            if (t === 'em' || t === 'i') return full.startsWith('</') ? '</em>' : '<em>';
            if (t === 'u') return full.startsWith('</') ? '</u>' : '<u>';
            if (t === 'p' || t === 'div') return full.startsWith('</') ? '<br>' : '';
            if (t === 'span') {
                if (full.startsWith('</')) return '</span>';
                if (!/\bseg-ref\b/.test(full)) return '';
                const attr = (name) => {
                    const hallado = new RegExp(`${name}\\s*=\\s*"([^"]*)"`, 'i').exec(full);
                    return hallado ? hallado[1].replace(/[<>"]/g, '') : '';
                };
                const clave = attr('data-clave');
                const nombre = attr('data-nombre');
                const src = attr('data-src');
                const srcSegura = src && !/^data:/i.test(src) ? src : '';
                return `<span class="seg-ref"${clave ? ` data-clave="${clave}"` : ''}${nombre ? ` data-nombre="${nombre}"` : ''}${srcSegura ? ` data-src="${srcSegura}"` : ''}>`;
            }
            return '';
        })
        .replace(/(?:<br>\s*){3,}/gi, '<br><br>')
        .replace(/^(?:<br>)+|(?:<br>)+$/gi, '')
        .trim();
}

/** Corrige 9.60000000000001 → 9.6 y conserva puntos tipo 7.1.1 */
function formatearPuntoNorma(value) {
    if (value === null || value === undefined || value === '') return null;

    if (typeof value === 'number' && Number.isFinite(value)) {
        const n = Math.round(value * 10000) / 10000;
        let s = String(n);
        if (s.includes('.')) {
            s = s.replace(/(\.\d*?)0+$/, '$1').replace(/\.$/, '');
        }
        return s;
    }

    let s = limpiarTexto(value);
    if (!s) return null;

    const artefacto = s.match(/^(\d+)\.(\d{1,4})0{4,}\d*$/);
    if (artefacto) {
        const dec = artefacto[2].replace(/0+$/, '');
        return dec ? `${artefacto[1]}.${dec}` : artefacto[1];
    }

    const num = Number(s);
    if (Number.isFinite(num) && /^\d+(\.\d+)?$/.test(s)) {
        return formatearPuntoNorma(num);
    }

    return s;
}

function celdaAHtml(value) {
    if (value === null || value === undefined) return null;
    if (typeof value === 'string') {
        const t = textoConSaltos(value);
        return t ? htmlConSaltos(escapeHtml(t)) : null;
    }
    if (value && typeof value === 'object' && Array.isArray(value.richText)) {
        const html = value.richText.map((part) => {
            let t = escapeHtml(part.text || '');
            if (!t) return '';
            if (part.font?.bold) t = `<strong>${t}</strong>`;
            if (part.font?.italic) t = `<em>${t}</em>`;
            if (part.font?.underline) t = `<u>${t}</u>`;
            return t;
        }).join('');
        const conSaltos = htmlConSaltos(html).trim();
        return conSaltos || null;
    }
    const plain = textoConSaltos(value);
    return plain ? htmlConSaltos(escapeHtml(plain)) : null;
}

function contextoUsuario(reqOrCtx) {
    if (reqOrCtx && reqOrCtx.nombre && reqOrCtx.perfil) {
        return reqOrCtx;
    }
    const u = reqOrCtx?.user || reqOrCtx || {};
    const roles = Array.isArray(u.roles)
        ? u.roles.map((r) => String(r).toLowerCase())
        : (u.rol ? [String(u.rol).toLowerCase()] : []);
    let perfil = 'Usuario';
    if (roles.includes('root')) perfil = 'Super Administrador';
    else if (roles.includes('administrador')) perfil = 'Administrador';
    else if (roles.includes('sgc')) perfil = 'SGC';
    else if (roles.length) perfil = roles[0];

    const nombre = String(u.nombre || u.nombre_completo || u.usuario || u.email || 'Usuario').trim();
    return {
        nombre,
        perfil,
        usuario_id: u.id || u.usuario_id || null
    };
}

function parsearFecha(value) {
    const txt = limpiarTexto(value);
    if (!txt) return null;
    if (value instanceof Date && !Number.isNaN(value.getTime())) {
        return value.toISOString().slice(0, 10);
    }
    const iso = txt.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
    const dmy = txt.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})/);
    if (dmy) {
        const dd = dmy[1].padStart(2, '0');
        const mm = dmy[2].padStart(2, '0');
        return `${dmy[3]}-${mm}-${dd}`;
    }
    return null;
}

/**
 * Responsable del punto en plantilla Excel:
 * - "c" / "cliente" → Cliente
 * - vacío u otro → Empresa
 */
function normalizarResponsablePunto(value) {
    const txt = limpiarTexto(value).toLowerCase();
    if (txt === 'c' || txt === 'cliente' || /^cliente\b/.test(txt)) return 'Cliente';
    return 'Empresa';
}

function parsearAplica(value) {
    const txt = limpiarTexto(value).toLowerCase();
    if (!txt) return null;
    if (txt === 'si' || txt === 'sí' || txt === 'aplica' || txt === 'x') return 1;
    if (txt === 'no' || txt === 'no aplica' || txt === 'n/a') return 0;
    return null;
}

function parsearIndicador(value) {
    const txt = limpiarTexto(value);
    if (!txt) return null;
    const n = Number(txt);
    if (!Number.isFinite(n)) return null;
    return Math.max(0, Math.min(100, Math.round(n)));
}

function parsearAccionMarcada(value) {
    const txt = limpiarTexto(value);
    if (!txt) return 0;
    const n = Number(txt);
    if (Number.isFinite(n) && n > 0) return 1;
    const lower = txt.toLowerCase();
    if (lower === 'x' || lower === 'si' || lower === 'sí' || lower === '1') return 1;
    return 0;
}

function categoriaDesdeNumero(numero) {
    if (numero >= 1 && numero <= 10) return 'nom-001-010';
    if (numero >= 11 && numero <= 20) return 'nom-011-020';
    if (numero >= 21 && numero <= 30) return 'nom-021-030';
    if (numero >= 31 && numero <= 40) return 'nom-031-040';
    return 'otras';
}

/** Celda cubierta por una combinación: el texto vive en la celda maestra (arriba a la izquierda). */
function celdaEsclava(cell) {
    return !!(cell && cell.master && cell.master.address !== cell.address);
}

/** Unifica guiones tipográficos (Google Sheets / Word) a guión ASCII. */
function normalizarGuiones(texto) {
    return String(texto || '').replace(/[\u2010-\u2015\u2212\uFE58\uFE63\uFF0D\u00AD]/g, '-');
}

function construirCodigoNom(match) {
    const numero = String(match[1]).padStart(3, '0');
    const parte = match[2] ? `-${match[2]}` : '';
    const autoridad = String(match[3]).toUpperCase();
    const anio = match[4];
    return `NOM-${numero}${parte}-${autoridad}-${anio}`;
}

function matchClaveNom(texto) {
    const normalizado = normalizarGuiones(texto).replace(/\s+/g, ' ').trim();
    if (!normalizado) return null;
    return normalizado.match(RE_NOM);
}

function extraerTituloDesdeBloque(bloque, codigo) {
    const bloqueNorm = normalizarGuiones(bloque);
    const idx = bloqueNorm.toUpperCase().indexOf(codigo.toUpperCase());
    if (idx < 0) return codigo;
    let rest = bloqueNorm.slice(idx + codigo.length).trim();
    const dupIdx = rest.search(/\bNORMA\s+Oficial\b/i);
    if (dupIdx > 0) rest = rest.slice(0, dupIdx).trim();
    rest = rest.replace(/^[,.\-–—:\s]+/, '').replace(/\s+/g, ' ').trim();
    if (!rest) return codigo;
    if (rest.length > 480) rest = `${rest.slice(0, 477).trim()}…`;
    return rest;
}

function textoFila(ws, rowNum, maxCols = MAX_COLS_ESCANEO) {
    let bloque = '';
    const row = ws.getRow(rowNum);
    for (let c = 1; c <= maxCols; c++) {
        const cell = row.getCell(c);
        if (celdaEsclava(cell)) continue;
        bloque += ' ' + limpiarTexto(valorCelda(cell));
    }
    return bloque.replace(/\s+/g, ' ').trim();
}

function valorCelda(cell) {
    if (!cell) return null;
    if (celdaEsclava(cell) && cell.master) return cell.master.value;
    return cell.value;
}

function metadatosDesdeMatch(match, bloqueTitulo) {
    const codigo = construirCodigoNom(match);
    const numero = parseInt(match[1], 10);
    const tituloBloque = extraerTituloDesdeBloque(bloqueTitulo || '', codigo);
    return {
        codigo,
        titulo: tituloBloque,
        autoridad: String(match[3]).toUpperCase(),
        anio: parseInt(match[4], 10),
        numero,
        categoria_id: categoriaDesdeNumero(numero)
    };
}

function extraerMetadatosNorma(ws, { nombreArchivo = '' } = {}) {
    let bloqueAcumulado = '';
    let match = null;
    let bloqueMatch = '';

    for (let r = 1; r <= Math.min(MAX_FILAS_BUSCAR_NOM, ws.rowCount || MAX_FILAS_BUSCAR_NOM); r++) {
        const fila = textoFila(ws, r);
        if (!fila) continue;
        bloqueAcumulado += (bloqueAcumulado ? ' ' : '') + fila;
        match = matchClaveNom(fila) || matchClaveNom(bloqueAcumulado);
        if (match) {
            bloqueMatch = bloqueAcumulado;
            // Título descriptivo suele estar en la fila siguiente.
            const siguiente = textoFila(ws, r + 1);
            if (siguiente && !matchClaveNom(siguiente) && !esFilaEncabezadoColumnas(siguiente)) {
                bloqueMatch = `${bloqueMatch} ${siguiente}`.trim();
            }
            break;
        }
    }

    if (!match) {
        match = matchClaveNom(ws.name || '');
        if (match) bloqueMatch = ws.name;
    }
    if (!match && nombreArchivo) {
        match = matchClaveNom(nombreArchivo);
        if (match) bloqueMatch = nombreArchivo;
    }
    if (!match) {
        const err = new Error(
            'No se detectó clave NOM en la plantilla (revise el título, p. ej. NOM-023-STPS-2012). Verifique el formato del archivo.'
        );
        err.status = 400;
        throw err;
    }
    return metadatosDesdeMatch(match, bloqueMatch);
}

function esFilaEncabezadoColumnas(texto) {
    const t = String(texto || '').toLowerCase();
    const tieneDesc = /descripci[oó]n/.test(t);
    const tieneAplica = /\baplica\b/.test(t);
    const tienePeriod = /periodicidad/.test(t);
    const tieneAccion = /conservar|mejorar|actualizar|complementar|corregir/.test(t);
    // "DOCUMENTAL" solo cuenta como encabezado si va junto a otros títulos de columna.
    const tieneDocHeader = /documental\s*\/\s*f[ií]sico/.test(t);
    const señales = [tieneDesc, tieneAplica, tienePeriod, tieneAccion, tieneDocHeader].filter(Boolean).length;
    return señales >= 2 || (tieneDesc && /requisito/.test(t) && (tieneAplica || tieneDocHeader || tienePeriod));
}

function textoCeldaHeader(cell) {
    return normalizarGuiones(limpiarTexto(valorCelda(cell))).toLowerCase();
}

function clasificarHeader(texto) {
    const t = String(texto || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    if (!t) return null;
    if (/^#+$/.test(t) || /^(item|n[o°.]?|num(ero)?)$/.test(t)) return 'ITEM';
    if (/^punto/.test(t) || t === 'pto' || t === 'pt') return 'PUNTO';
    if (/descripcion/.test(t) && /requisito/.test(t)) return 'DESCRIPCION';
    if (/descripcion/.test(t)) return 'DESCRIPCION';
    if (/aplica/.test(t)) return 'APLICA';
    if (/documental|fisico|fisico/.test(t)) return 'TIPO_EVIDENCIA';
    if (/periodicidad|frecuencia/.test(t)) return 'PERIODICIDAD';
    if (/conservar/.test(t)) return 'PREV_CONSERVAR';
    if (/mejorar/.test(t)) return 'PREV_MEJORAR';
    if (/actualizar/.test(t)) return 'PREV_ACTUALIZAR';
    if (/complementar/.test(t)) return 'CORR_COMPLEMENTAR';
    if (/corregir/.test(t)) return 'CORR_CORREGIR';
    if (/^realizar$/.test(t) || (t.includes('realizar') && !t.includes('prevent'))) return 'CORR_REALIZAR';
    if (/fecha.*inicio|inicio/.test(t) && /fecha/.test(t)) return 'FECHA_INICIO';
    if (/fecha.*termin|terminacion|termino/.test(t)) return 'FECHA_TERMINACION';
    if (/responsable/.test(t)) return 'RESPONSABLE';
    if (/indicador|avance/.test(t)) return 'INDICADOR_AVANCE';
    if (/evidencia/.test(t)) return 'EVIDENCIA_REQUERIDA';
    if (/observacion/.test(t)) return 'OBSERVACIONES';
    return null;
}

/**
 * Detecta mapa de columnas y fila de inicio según encabezados reales.
 * Soporta layout clásico (Ítem/Punto/Desc) y el de NOM-023 (solo Descripción).
 */
function detectarEstructuraPlantilla(ws) {
    const maxRow = Math.min(12, ws.rowCount || 12);
    let mejor = null;

    for (let r = 1; r <= maxRow; r++) {
        const mapa = {};
        let hits = 0;
        for (let c = 1; c <= MAX_COLS_ESCANEO; c++) {
            const cell = ws.getRow(r).getCell(c);
            if (celdaEsclava(cell)) continue;
            const clave = clasificarHeader(textoCeldaHeader(cell));
            if (!clave || mapa[clave]) continue;
            mapa[clave] = c;
            hits += 1;
        }
        // También mira la fila siguiente (encabezados partidos en 2 filas).
        if (r + 1 <= maxRow) {
            for (let c = 1; c <= MAX_COLS_ESCANEO; c++) {
                const cell = ws.getRow(r + 1).getCell(c);
                if (celdaEsclava(cell)) continue;
                const clave = clasificarHeader(textoCeldaHeader(cell));
                if (!clave || mapa[clave]) continue;
                mapa[clave] = c;
                hits += 1;
            }
        }
        if (hits < 2 || !mapa.DESCRIPCION) continue;
        const score = hits
            + (mapa.APLICA ? 2 : 0)
            + (mapa.TIPO_EVIDENCIA ? 2 : 0)
            + (mapa.PERIODICIDAD ? 1 : 0)
            + (mapa.PREV_CONSERVAR ? 1 : 0);
        if (!mejor || score > mejor.score) {
            mejor = { mapa, headerRow: r, score };
        }
    }

    if (mejor) {
        const cols = { ...COL_SOLO_DESCRIPCION, ...mejor.mapa };
        const filaInicio = inferirFilaInicioDatos(ws, mejor.headerRow, cols);
        return {
            cols,
            filaInicio,
            tienePunto: !!mejor.mapa.PUNTO,
            tieneItem: !!mejor.mapa.ITEM
        };
    }

    // Fallback: si la descripción vive en A (merge A:C) como en NOM-023.
    if (pareceLayoutSoloDescripcion(ws)) {
        return {
            cols: { ...COL_SOLO_DESCRIPCION },
            filaInicio: inferirFilaInicioDatos(ws, 3, COL_SOLO_DESCRIPCION),
            tienePunto: false,
            tieneItem: false
        };
    }

    return {
        cols: { ...COL_CLASICO },
        filaInicio: FILA_INICIO_DATOS_DEFAULT,
        tienePunto: true,
        tieneItem: true
    };
}

function pareceLayoutSoloDescripcion(ws) {
    for (let r = 3; r <= 6; r++) {
        const t = textoFila(ws, r).toLowerCase();
        if (/descripci[oó]n/.test(t) && /requisito/.test(t) && !/\bpunto\b/.test(t)) return true;
    }
    return false;
}

function inferirFilaInicioDatos(ws, headerRow, cols) {
    const desde = Math.max(headerRow + 1, 4);
    const hasta = Math.min((ws.rowCount || 40), headerRow + 8);
    for (let r = desde; r <= hasta; r++) {
        if (esFilaPuntajesAccion(ws, r, cols)) continue;
        if (esFilaEncabezadoColumnas(textoFila(ws, r))) continue;
        const desc = limpiarTexto(valorCelda(ws.getRow(r).getCell(cols.DESCRIPCION || 1)));
        if (!desc) continue;
        if (/descripci[oó]n/i.test(desc)) continue;
        return r;
    }
    return Math.max(headerRow + 2, FILA_INICIO_DATOS_DEFAULT);
}

function esFilaPuntajesAccion(ws, rowNum, cols) {
    const vals = [
        cols.PREV_CONSERVAR, cols.PREV_MEJORAR, cols.PREV_ACTUALIZAR,
        cols.CORR_COMPLEMENTAR, cols.CORR_CORREGIR, cols.CORR_REALIZAR
    ]
        .filter(Boolean)
        .map((c) => {
            const raw = limpiarTexto(valorCelda(ws.getRow(rowNum).getCell(c)));
            if (!raw) return null;
            const n = Number(raw);
            return Number.isFinite(n) ? n : null;
        })
        .filter((n) => n !== null);
    if (vals.length < 3) return false;
    const conocidos = new Set([100, 80, 60, 40, 20, 0]);
    const hits = vals.filter((n) => conocidos.has(n)).length;
    const desc = limpiarTexto(valorCelda(ws.getRow(rowNum).getCell(cols.DESCRIPCION || 1)));
    return hits >= 3 && !desc;
}

function anexarDescripcion(destino, texto, html) {
    const fragmento = String(texto || '').trim();
    if (!fragmento) return;
    const previo = String(destino.descripcion || '').trim();
    if (previo === fragmento) return;
    const lineasPrevias = new Set(previo.split('\n').map((linea) => linea.trim()).filter(Boolean));
    if (!fragmento.includes('\n') && lineasPrevias.has(fragmento)) return;

    destino.descripcion = previo ? `${previo}\n${fragmento}` : fragmento;
    const htmlFragmento = html || htmlDesdeDescripcion(fragmento);
    destino.descripcion_html = destino.descripcion_html
        ? `${destino.descripcion_html}<br>${htmlFragmento}`
        : htmlFragmento;
}

function completarCamposDelPunto(destino, extra) {
    if (destino.numero_item == null && extra.numero_item != null) destino.numero_item = extra.numero_item;
    if (!destino.punto_norma && extra.punto_norma) destino.punto_norma = extra.punto_norma;
    if (destino.aplica == null && extra.aplica != null) destino.aplica = extra.aplica;
    if (destino.indicador_avance == null && extra.indicador_avance != null) {
        destino.indicador_avance = extra.indicador_avance;
    }
    for (const campo of [
        'tipo_evidencia', 'periodicidad', 'fecha_inicio', 'fecha_terminacion',
        'responsable', 'evidencia_requerida', 'observaciones'
    ]) {
        if (!destino[campo] && extra[campo]) destino[campo] = extra[campo];
    }
    for (const campo of [
        'accion_prev_conservar', 'accion_prev_mejorar', 'accion_prev_actualizar',
        'accion_corr_complementar', 'accion_corr_corregir', 'accion_corr_realizar'
    ]) {
        if (extra[campo]) destino[campo] = 1;
    }
}

/**
 * Continuación del mismo punto solo si hay columna Punto y la fila no trae uno nuevo
 * (celda combinada o vacía). Sin columna Punto, cada descripción es un requisito.
 */
function filaContinuaElPunto(actual, req, celdaPunto, estructura) {
    if (!actual || !req) return false;
    if (estructura?.tienePunto) {
        if (celdaPunto && celdaEsclava(celdaPunto)) return true;
        if (req.punto_norma && actual.punto_norma && req.punto_norma === actual.punto_norma) return true;
        if (!req.punto_norma && actual.punto_norma) return true;
        return false;
    }
    return false;
}

function leerColumna(row, col) {
    if (!col) return null;
    return valorCelda(row.getCell(col));
}

function extraerPuntoDesdeDescripcion(descripcion) {
    const txt = String(descripcion || '').trim();
    const m = txt.match(/^(\d+(?:\.\d+){0,6})\b/);
    return m ? formatearPuntoNorma(m[1]) : null;
}

function parsearFilaRequisito(ws, rowNum, estructura) {
    const cols = estructura.cols;
    const row = ws.getRow(rowNum);
    const celdaPuntoVal = leerColumna(row, cols.PUNTO);
    const celdaDescVal = leerColumna(row, cols.DESCRIPCION);
    const numeroItem = cols.ITEM ? limpiarTexto(leerColumna(row, cols.ITEM)) : '';
    let punto = formatearPuntoNorma(celdaPuntoVal);
    const descripcion = textoConSaltos(celdaDescVal);
    const descripcionHtml = celdaAHtml(celdaDescVal);
    if (!punto && descripcion) punto = extraerPuntoDesdeDescripcion(descripcion);

    if (!numeroItem && !punto && !descripcion) return null;
    if (!punto && !descripcion) return null;
    // Evita tomar la fila de encabezados o la de puntajes 100/80/60…
    if (descripcion && /descripci[oó]n\s+del\s+requisito/i.test(descripcion)) return null;
    if (esFilaPuntajesAccion(ws, rowNum, cols)) return null;

    return {
        numero_item: numeroItem ? parseInt(numeroItem, 10) || null : null,
        punto_norma: punto || null,
        descripcion: descripcion || null,
        descripcion_html: descripcionHtml,
        aplica: parsearAplica(leerColumna(row, cols.APLICA)),
        tipo_evidencia: limpiarTexto(leerColumna(row, cols.TIPO_EVIDENCIA)) || null,
        periodicidad: limpiarTexto(leerColumna(row, cols.PERIODICIDAD)) || null,
        accion_prev_conservar: parsearAccionMarcada(leerColumna(row, cols.PREV_CONSERVAR)),
        accion_prev_mejorar: parsearAccionMarcada(leerColumna(row, cols.PREV_MEJORAR)),
        accion_prev_actualizar: parsearAccionMarcada(leerColumna(row, cols.PREV_ACTUALIZAR)),
        accion_corr_complementar: parsearAccionMarcada(leerColumna(row, cols.CORR_COMPLEMENTAR)),
        accion_corr_corregir: parsearAccionMarcada(leerColumna(row, cols.CORR_CORREGIR)),
        accion_corr_realizar: parsearAccionMarcada(leerColumna(row, cols.CORR_REALIZAR)),
        fecha_inicio: parsearFecha(leerColumna(row, cols.FECHA_INICIO)),
        fecha_terminacion: parsearFecha(leerColumna(row, cols.FECHA_TERMINACION)),
        responsable: normalizarResponsablePunto(leerColumna(row, cols.RESPONSABLE)),
        indicador_avance: parsearIndicador(leerColumna(row, cols.INDICADOR_AVANCE)),
        evidencia_requerida: limpiarTexto(leerColumna(row, cols.EVIDENCIA_REQUERIDA)) || null,
        observaciones: limpiarTexto(leerColumna(row, cols.OBSERVACIONES)) || null,
        orden: rowNum - estructura.filaInicio + 1
    };
}

function elegirHojaPlantilla(wb, nombreArchivo = '') {
    if (!wb.worksheets.length) return null;
    let mejor = null;
    for (const ws of wb.worksheets) {
        let score = 0;
        try {
            extraerMetadatosNorma(ws, { nombreArchivo });
            score += 5;
        } catch (_) { /* sin NOM en esta hoja */ }
        const estructura = detectarEstructuraPlantilla(ws);
        if (estructura.cols.DESCRIPCION) score += 2;
        if (estructura.tienePunto) score += 1;
        const muestra = textoFila(ws, estructura.filaInicio);
        if (muestra) score += 2;
        if (!mejor || score > mejor.score) mejor = { ws, score, estructura };
    }
    return mejor;
}

async function parsearPlantillaExcel(buffer, { nombreArchivo = '' } = {}) {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buffer);
    if (!wb.worksheets.length) {
        const err = new Error('El archivo Excel no contiene hojas de cálculo.');
        err.status = 400;
        throw err;
    }

    const elegido = elegirHojaPlantilla(wb, nombreArchivo);
    const ws = elegido?.ws || wb.worksheets[0];
    const meta = extraerMetadatosNorma(ws, { nombreArchivo });
    const estructura = elegido?.estructura || detectarEstructuraPlantilla(ws);
    const requisitos = [];
    let actual = null;

    for (let r = estructura.filaInicio; r <= ws.rowCount; r++) {
        const row = ws.getRow(r);
        const celdaDesc = row.getCell(estructura.cols.DESCRIPCION);
        // La descripción combinada ya quedó completa en la celda maestra.
        if (celdaEsclava(celdaDesc)) continue;

        const req = parsearFilaRequisito(ws, r, estructura);
        if (!req) continue;

        const celdaPunto = estructura.cols.PUNTO ? row.getCell(estructura.cols.PUNTO) : null;
        if (filaContinuaElPunto(actual, req, celdaPunto, estructura)) {
            anexarDescripcion(actual, req.descripcion, req.descripcion_html);
            completarCamposDelPunto(actual, req);
            continue;
        }

        requisitos.push(req);
        actual = req;
    }
    if (!requisitos.length) {
        const err = new Error(
            `No se encontraron requisitos en la plantilla (desde fila ${estructura.filaInicio}).`
        );
        err.status = 400;
        throw err;
    }

    // Si el título quedó solo como código, complementa con subtítulo de fila 2.
    if (meta.titulo === meta.codigo) {
        const sub = textoFila(ws, 2);
        if (sub && !matchClaveNom(sub) && !esFilaEncabezadoColumnas(sub)) {
            meta.titulo = sub.length > 480 ? `${sub.slice(0, 477).trim()}…` : sub;
        }
    }

    return { meta, requisitos, estructura };
}

async function columnExists(pool, table, column) {
    const [rows] = await pool.query(
        `SELECT 1 FROM information_schema.COLUMNS
         WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ? LIMIT 1`,
        [table, column]
    );
    return rows.length > 0;
}

async function addColumnIfNotExists(pool, table, column, definition) {
    if (await columnExists(pool, table, column)) return;
    await pool.query(`ALTER TABLE \`${table}\` ADD COLUMN \`${column}\` ${definition}`);
}

function asegurarCarpeta(dir) {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function extensionPermitida(nombre, mapa) {
    const ext = path.extname(String(nombre || '')).toLowerCase();
    return mapa[ext] || null;
}

function nombreVisible(nombre) {
    const limpio = String(nombre || '').replace(/[\\/:*?"<>|]/g, ' ').replace(/\s+/g, ' ').trim();
    return limpio.slice(0, 180) || 'formato';
}

function rutaPublica(abs) {
    const rel = path.relative(path.join(__dirname, 'uploads'), abs).split(path.sep).join('/');
    return `/uploads/${rel}`;
}

function absolutoSeguro(publicPath) {
    if (!publicPath || typeof publicPath !== 'string' || !publicPath.startsWith('/uploads/normativas/')) return null;
    const abs = path.resolve(__dirname, publicPath.replace(/^\//, ''));
    const base = path.resolve(__dirname, 'uploads', 'normativas');
    if (abs !== base && !abs.startsWith(base + path.sep)) return null;
    return abs;
}

function borrarArchivoSeguro(publicPath) {
    const abs = absolutoSeguro(publicPath);
    if (!abs) return;
    if (fs.existsSync(abs)) fs.unlinkSync(abs);
}

async function normalizarPuntosExistentes(pool) {
    const [rows] = await pool.query(
        `SELECT id, punto_norma FROM seg_normativa_requisito WHERE punto_norma IS NOT NULL`
    );
    for (const row of rows) {
        const fixed = formatearPuntoNorma(row.punto_norma);
        if (fixed && fixed !== row.punto_norma) {
            await pool.query(
                'UPDATE seg_normativa_requisito SET punto_norma = ? WHERE id = ?',
                [fixed, row.id]
            );
        }
    }
}

/** Homologa valores legacy de Excel ("c", null) a Cliente / Empresa. */
async function normalizarResponsablesExistentes(pool) {
    await pool.query(`
        UPDATE seg_normativa_requisito
        SET responsable = CASE
            WHEN responsable IS NOT NULL
                 AND LOWER(TRIM(responsable)) IN ('c', 'cliente') THEN 'Cliente'
            ELSE 'Empresa'
        END
        WHERE IFNULL(responsable, '') NOT IN ('Cliente', 'Empresa')
    `);
}

async function asegurarTablas(pool) {
    if (!pool?.query) throw new Error('Pool de normativas no disponible');

    await pool.query(`
        CREATE TABLE IF NOT EXISTS seg_normativa (
          id INT UNSIGNED NOT NULL AUTO_INCREMENT,
          codigo VARCHAR(40) NOT NULL,
          titulo VARCHAR(500) NOT NULL,
          autoridad VARCHAR(32) NOT NULL DEFAULT 'STPS',
          anio SMALLINT UNSIGNED NULL,
          numero SMALLINT UNSIGNED NULL,
          categoria_id VARCHAR(24) NOT NULL DEFAULT 'otras',
          estado ENUM('borrador','activa','archivada') NOT NULL DEFAULT 'activa',
          total_requisitos INT UNSIGNED NOT NULL DEFAULT 0,
          hash_plantilla CHAR(64) NULL,
          importado_por VARCHAR(120) NULL,
          importado_perfil VARCHAR(80) NULL,
          importado_en DATETIME NULL,
          created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
          PRIMARY KEY (id),
          UNIQUE KEY uk_codigo (codigo),
          KEY idx_categoria (categoria_id),
          KEY idx_estado (estado)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    await pool.query(`
        CREATE TABLE IF NOT EXISTS seg_normativa_requisito (
          id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
          normativa_id INT UNSIGNED NOT NULL,
          numero_item INT UNSIGNED NULL,
          punto_norma VARCHAR(32) NULL,
          descripcion TEXT NULL,
          descripcion_html MEDIUMTEXT NULL,
          aplica TINYINT(1) NULL,
          tipo_evidencia VARCHAR(40) NULL,
          periodicidad VARCHAR(32) NULL,
          accion_prev_conservar TINYINT(1) NOT NULL DEFAULT 0,
          accion_prev_mejorar TINYINT(1) NOT NULL DEFAULT 0,
          accion_prev_actualizar TINYINT(1) NOT NULL DEFAULT 0,
          accion_corr_complementar TINYINT(1) NOT NULL DEFAULT 0,
          accion_corr_corregir TINYINT(1) NOT NULL DEFAULT 0,
          accion_corr_realizar TINYINT(1) NOT NULL DEFAULT 0,
          fecha_inicio DATE NULL,
          fecha_terminacion DATE NULL,
          responsable VARCHAR(160) NULL,
          indicador_avance TINYINT UNSIGNED NULL,
          evidencia_requerida TEXT NULL,
          observaciones TEXT NULL,
          orden INT UNSIGNED NOT NULL DEFAULT 0,
          created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
          PRIMARY KEY (id),
          KEY idx_normativa (normativa_id),
          KEY idx_punto (punto_norma),
          KEY idx_orden (normativa_id, orden),
          CONSTRAINT fk_seg_req_normativa FOREIGN KEY (normativa_id)
            REFERENCES seg_normativa (id) ON DELETE CASCADE
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    await pool.query(`
        CREATE TABLE IF NOT EXISTS seg_normativa_importacion (
          id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
          normativa_id INT UNSIGNED NOT NULL,
          nombre_archivo VARCHAR(255) NOT NULL,
          filas_importadas INT UNSIGNED NOT NULL DEFAULT 0,
          hash_archivo CHAR(64) NULL,
          importado_por VARCHAR(120) NULL,
          importado_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
          PRIMARY KEY (id),
          KEY idx_normativa_import (normativa_id),
          CONSTRAINT fk_seg_imp_normativa FOREIGN KEY (normativa_id)
            REFERENCES seg_normativa (id) ON DELETE CASCADE
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    await pool.query(`
        CREATE TABLE IF NOT EXISTS seg_normativa_historial (
          id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
          normativa_id INT UNSIGNED NOT NULL,
          requisito_id BIGINT UNSIGNED NULL,
          accion VARCHAR(40) NOT NULL,
          campo VARCHAR(64) NULL,
          detalle VARCHAR(500) NULL,
          valor_anterior TEXT NULL,
          valor_nuevo TEXT NULL,
          usuario_nombre VARCHAR(120) NOT NULL,
          usuario_perfil VARCHAR(80) NULL,
          creado_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
          PRIMARY KEY (id),
          KEY idx_hist_normativa (normativa_id, creado_en),
          KEY idx_hist_requisito (requisito_id),
          CONSTRAINT fk_seg_hist_normativa FOREIGN KEY (normativa_id)
            REFERENCES seg_normativa (id) ON DELETE CASCADE
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    await addColumnIfNotExists(pool, 'seg_normativa', 'importado_perfil', 'VARCHAR(80) NULL');
    await addColumnIfNotExists(pool, 'seg_normativa', 'imagen_portada', 'VARCHAR(255) NULL');
    await addColumnIfNotExists(pool, 'seg_normativa_requisito', 'descripcion_html', 'MEDIUMTEXT NULL');
    await addColumnIfNotExists(pool, 'seg_normativa_requisito', 'formato_nombre', 'VARCHAR(200) NULL');
    await addColumnIfNotExists(pool, 'seg_normativa_requisito', 'formato_archivo', 'VARCHAR(255) NULL');
    await addColumnIfNotExists(pool, 'seg_normativa_requisito', 'formato_nombre_archivo', 'VARCHAR(180) NULL');

    await pool.query(`
        CREATE TABLE IF NOT EXISTS seg_normativa_requisito_imagen (
          id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
          normativa_id INT UNSIGNED NOT NULL,
          requisito_id BIGINT UNSIGNED NOT NULL,
          ruta VARCHAR(255) NOT NULL,
          nombre VARCHAR(180) NOT NULL,
          orden SMALLINT UNSIGNED NOT NULL DEFAULT 0,
          creado_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
          PRIMARY KEY (id),
          KEY idx_req_img (requisito_id, orden),
          KEY idx_norm_img (normativa_id),
          CONSTRAINT fk_seg_img_normativa FOREIGN KEY (normativa_id)
            REFERENCES seg_normativa (id) ON DELETE CASCADE,
          CONSTRAINT fk_seg_img_requisito FOREIGN KEY (requisito_id)
            REFERENCES seg_normativa_requisito (id) ON DELETE CASCADE
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    await normalizarPuntosExistentes(pool);
    await normalizarResponsablesExistentes(pool);
}

async function registrarHistorial(conn, {
    normativaId,
    requisitoId = null,
    accion,
    campo = null,
    detalle = null,
    valorAnterior = null,
    valorNuevo = null,
    usuario
}) {
    const ctx = contextoUsuario(usuario);
    const trunc = (v) => {
        if (v === null || v === undefined) return null;
        const s = String(v);
        return s.length > 4000 ? `${s.slice(0, 3997)}…` : s;
    };
    await conn.query(
        `INSERT INTO seg_normativa_historial
         (normativa_id, requisito_id, accion, campo, detalle, valor_anterior, valor_nuevo,
          usuario_nombre, usuario_perfil)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
            normativaId,
            requisitoId,
            accion,
            campo,
            detalle,
            trunc(valorAnterior),
            trunc(valorNuevo),
            ctx.nombre,
            ctx.perfil
        ]
    );
}

function mapNormativaRow(row) {
    return {
        id: row.id,
        codigo: row.codigo,
        titulo: row.titulo,
        autoridad: row.autoridad,
        anio: row.anio,
        numero: row.numero,
        categoria_id: row.categoria_id,
        estado: row.estado,
        total_requisitos: row.total_requisitos,
        importado_por: row.importado_por,
        importado_perfil: row.importado_perfil || null,
        importado_en: row.importado_en,
        imagen_portada: row.imagen_portada || null,
        updated_at: row.updated_at
    };
}

function mapRequisitoRow(row) {
    return {
        id: row.id,
        normativa_id: row.normativa_id,
        numero_item: row.numero_item,
        punto_norma: formatearPuntoNorma(row.punto_norma),
        descripcion: row.descripcion,
        descripcion_html: row.descripcion_html || null,
        aplica: row.aplica == null ? null : !!Number(row.aplica),
        tipo_evidencia: row.tipo_evidencia,
        periodicidad: row.periodicidad,
        acciones: {
            preventiva: {
                conservar: !!row.accion_prev_conservar,
                mejorar: !!row.accion_prev_mejorar,
                actualizar: !!row.accion_prev_actualizar
            },
            correctiva: {
                complementar: !!row.accion_corr_complementar,
                corregir: !!row.accion_corr_corregir,
                realizar: !!row.accion_corr_realizar
            }
        },
        fecha_inicio: row.fecha_inicio,
        fecha_terminacion: row.fecha_terminacion,
        responsable: normalizarResponsablePunto(row.responsable),
        indicador_avance: row.indicador_avance,
        evidencia_requerida: row.evidencia_requerida,
        observaciones: row.observaciones,
        formato_nombre: row.formato_nombre || null,
        formato_archivo: row.formato_archivo || null,
        formato_nombre_archivo: row.formato_nombre_archivo || null,
        orden: row.orden
    };
}

function mapHistorialRow(row) {
    return {
        id: row.id,
        normativa_id: row.normativa_id,
        requisito_id: row.requisito_id,
        accion: row.accion,
        campo: row.campo,
        detalle: row.detalle,
        valor_anterior: row.valor_anterior,
        valor_nuevo: row.valor_nuevo,
        usuario_nombre: row.usuario_nombre,
        usuario_perfil: row.usuario_perfil,
        creado_en: row.creado_en
    };
}

async function listarCatalogo(pool, { busqueda = '', categoriaId = '' } = {}) {
    const params = [];
    let where = 'WHERE n.estado != \'archivada\'';
    if (categoriaId) {
        where += ' AND n.categoria_id = ?';
        params.push(categoriaId);
    }
    if (busqueda) {
        where += ' AND (n.codigo LIKE ? OR n.titulo LIKE ?)';
        const q = `%${busqueda.trim()}%`;
        params.push(q, q);
    }

    const [rows] = await pool.query(
        `SELECT n.id, n.codigo, n.titulo, n.autoridad, n.anio, n.numero, n.categoria_id,
                n.estado, n.total_requisitos, n.importado_por, n.importado_perfil,
                n.importado_en, n.imagen_portada, n.updated_at
         FROM seg_normativa n
         ${where}
         ORDER BY n.numero ASC, n.codigo ASC`,
        params
    );
    return rows.map(mapNormativaRow);
}

async function obtenerNormativa(pool, id) {
    const [rows] = await pool.query(
        `SELECT id, codigo, titulo, autoridad, anio, numero, categoria_id, estado,
                total_requisitos, importado_por, importado_perfil, importado_en,
                imagen_portada, updated_at
         FROM seg_normativa WHERE id = ? LIMIT 1`,
        [id]
    );
    if (!rows.length) {
        const err = new Error('Normativa no encontrada');
        err.status = 404;
        throw err;
    }
    return mapNormativaRow(rows[0]);
}

async function listarRequisitos(pool, normativaId, { busqueda = '' } = {}) {
    const params = [normativaId];
    let where = 'WHERE normativa_id = ?';
    if (busqueda) {
        where += ' AND (punto_norma LIKE ? OR descripcion LIKE ? OR evidencia_requerida LIKE ? OR formato_nombre LIKE ?)';
        const q = `%${busqueda.trim()}%`;
        params.push(q, q, q, q);
    }
    const [rows] = await pool.query(
        `SELECT * FROM seg_normativa_requisito ${where} ORDER BY orden ASC, id ASC`,
        params
    );
    const requisitos = rows.map(mapRequisitoRow);
    return anexarImagenesReferencia(pool, normativaId, requisitos);
}

async function anexarImagenesReferencia(pool, normativaId, requisitos) {
    if (!requisitos.length) return requisitos;
    const [imgs] = await pool.query(
        `SELECT id, requisito_id, ruta, nombre
         FROM seg_normativa_requisito_imagen
         WHERE normativa_id = ?
         ORDER BY orden ASC, id ASC`,
        [normativaId]
    );
    const porReq = new Map();
    for (const img of imgs) {
        const lista = porReq.get(img.requisito_id) || [];
        lista.push({ id: img.id, ruta: img.ruta, nombre: img.nombre });
        porReq.set(img.requisito_id, lista);
    }
    return requisitos.map((r) => ({ ...r, imagenes: porReq.get(r.id) || [] }));
}

async function listarHistorial(pool, normativaId, { limit = 50 } = {}) {
    const lim = Math.min(Math.max(parseInt(limit, 10) || 50, 1), 200);
    const [rows] = await pool.query(
        `SELECT * FROM seg_normativa_historial
         WHERE normativa_id = ?
         ORDER BY creado_en DESC, id DESC
         LIMIT ?`,
        [normativaId, lim]
    );
    return rows.map(mapHistorialRow);
}

async function obtenerResumen(pool, normativaId) {
    const [rows] = await pool.query(
        `SELECT
            COUNT(*) AS total,
            SUM(CASE WHEN tipo_evidencia LIKE '%DOCUMENTAL%' THEN 1 ELSE 0 END) AS documentales,
            SUM(CASE WHEN tipo_evidencia LIKE '%FISICO%' OR tipo_evidencia LIKE '%FÍSICO%' THEN 1 ELSE 0 END) AS fisicos,
            SUM(CASE WHEN periodicidad IS NOT NULL AND periodicidad != '' THEN 1 ELSE 0 END) AS con_periodicidad
         FROM seg_normativa_requisito WHERE normativa_id = ?`,
        [normativaId]
    );
    return rows[0] || {};
}

async function importarDesdeExcel(pool, buffer, { nombreArchivo = 'plantilla.xlsx', usuario = null } = {}) {
    const hash = crypto.createHash('sha256').update(buffer).digest('hex');
    const { meta, requisitos } = await parsearPlantillaExcel(buffer, { nombreArchivo });
    const ctx = contextoUsuario(usuario);

    const conn = await pool.getConnection();
    try {
        await conn.beginTransaction();

        const [existentes] = await conn.query(
            'SELECT id FROM seg_normativa WHERE codigo = ? LIMIT 1',
            [meta.codigo]
        );

        const esReimport = !!existentes.length;
        let normativaId;
        let formatosPrevios = new Map();
        if (esReimport) {
            normativaId = existentes[0].id;
            const [previos] = await conn.query(
                `SELECT punto_norma, formato_nombre, formato_archivo, formato_nombre_archivo
                 FROM seg_normativa_requisito
                 WHERE normativa_id = ?
                   AND (formato_archivo IS NOT NULL OR (formato_nombre IS NOT NULL AND formato_nombre != ''))`,
                [normativaId]
            );
            formatosPrevios = new Map(
                previos.map((row) => [formatearPuntoNorma(row.punto_norma), row])
            );
            await conn.query(
                `UPDATE seg_normativa SET titulo = ?, autoridad = ?, anio = ?, numero = ?,
                    categoria_id = ?, total_requisitos = ?, hash_plantilla = ?,
                    importado_por = ?, importado_perfil = ?, importado_en = NOW(), estado = 'activa'
                 WHERE id = ?`,
                [meta.titulo, meta.autoridad, meta.anio, meta.numero, meta.categoria_id,
                    requisitos.length, hash, ctx.nombre, ctx.perfil, normativaId]
            );
            await conn.query('DELETE FROM seg_normativa_requisito WHERE normativa_id = ?', [normativaId]);
        } else {
            const [ins] = await conn.query(
                `INSERT INTO seg_normativa
                 (codigo, titulo, autoridad, anio, numero, categoria_id, total_requisitos,
                  hash_plantilla, importado_por, importado_perfil, importado_en, estado)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), 'activa')`,
                [meta.codigo, meta.titulo, meta.autoridad, meta.anio, meta.numero,
                    meta.categoria_id, requisitos.length, hash, ctx.nombre, ctx.perfil]
            );
            normativaId = ins.insertId;
        }

        for (const req of requisitos) {
            await conn.query(
                `INSERT INTO seg_normativa_requisito (
                    normativa_id, numero_item, punto_norma, descripcion, descripcion_html, aplica,
                    tipo_evidencia, periodicidad, accion_prev_conservar, accion_prev_mejorar,
                    accion_prev_actualizar, accion_corr_complementar, accion_corr_corregir,
                    accion_corr_realizar, fecha_inicio, fecha_terminacion, responsable,
                    indicador_avance, evidencia_requerida, observaciones, orden
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                [
                    normativaId, req.numero_item, req.punto_norma, req.descripcion,
                    req.descripcion_html, req.aplica, req.tipo_evidencia, req.periodicidad,
                    req.accion_prev_conservar, req.accion_prev_mejorar, req.accion_prev_actualizar,
                    req.accion_corr_complementar, req.accion_corr_corregir, req.accion_corr_realizar,
                    req.fecha_inicio, req.fecha_terminacion, req.responsable, req.indicador_avance,
                    req.evidencia_requerida, req.observaciones, req.orden
                ]
            );
        }

        if (esReimport && formatosPrevios.size) {
            const [nuevos] = await conn.query(
                'SELECT id, punto_norma FROM seg_normativa_requisito WHERE normativa_id = ?',
                [normativaId]
            );
            for (const row of nuevos) {
                const previo = formatosPrevios.get(formatearPuntoNorma(row.punto_norma));
                if (!previo) continue;
                await conn.query(
                    `UPDATE seg_normativa_requisito
                     SET formato_nombre = ?, formato_archivo = ?, formato_nombre_archivo = ?
                     WHERE id = ?`,
                    [previo.formato_nombre, previo.formato_archivo, previo.formato_nombre_archivo, row.id]
                );
            }
        }

        await conn.query(
            `INSERT INTO seg_normativa_importacion
             (normativa_id, nombre_archivo, filas_importadas, hash_archivo, importado_por)
             VALUES (?, ?, ?, ?, ?)`,
            [normativaId, nombreArchivo, requisitos.length, hash, ctx.nombre]
        );

        await registrarHistorial(conn, {
            normativaId,
            accion: esReimport ? 'reimportacion' : 'importacion',
            detalle: `${esReimport ? 'Reimportación' : 'Importación'} desde ${nombreArchivo} (${requisitos.length} requisitos)`,
            usuario: ctx
        });

        await conn.commit();

        const normativa = await obtenerNormativa(pool, normativaId);
        return {
            normativa,
            requisitos_importados: requisitos.length,
            reemplazo: esReimport
        };
    } catch (error) {
        await conn.rollback();
        throw error;
    } finally {
        conn.release();
    }
}

async function actualizarNormativa(pool, id, datos, usuario) {
    const normativa = await obtenerNormativa(pool, id);
    const titulo = String(datos.titulo || '').trim();
    if (!titulo) {
        const err = new Error('El título es obligatorio');
        err.status = 400;
        throw err;
    }
    if (titulo === normativa.titulo) {
        return normativa;
    }

    const conn = await pool.getConnection();
    try {
        await conn.beginTransaction();
        await conn.query('UPDATE seg_normativa SET titulo = ? WHERE id = ?', [titulo, id]);
        await registrarHistorial(conn, {
            normativaId: id,
            accion: 'edicion_normativa',
            campo: 'titulo',
            valorAnterior: normativa.titulo,
            valorNuevo: titulo,
            detalle: `Título de ${normativa.codigo}`,
            usuario
        });
        await conn.commit();
    } catch (e) {
        await conn.rollback();
        throw e;
    } finally {
        conn.release();
    }

    return obtenerNormativa(pool, id);
}

async function actualizarRequisito(pool, normativaId, requisitoId, datos, usuario) {
    const [rows] = await pool.query(
        'SELECT * FROM seg_normativa_requisito WHERE id = ? AND normativa_id = ? LIMIT 1',
        [requisitoId, normativaId]
    );
    if (!rows.length) {
        const err = new Error('Requisito no encontrado');
        err.status = 404;
        throw err;
    }
    const prev = rows[0];
    const texto = (valor, anterior) => {
        if (valor === undefined) return anterior;
        if (valor === null) return null;
        const limpio = String(valor).trim();
        return limpio || null;
    };
    const punto = datos.punto_norma !== undefined
        ? (formatearPuntoNorma(datos.punto_norma) || texto(datos.punto_norma, null))
        : prev.punto_norma;
    const quitarFormato = datos.quitar_formato === true || datos.quitar_formato === 'true';
    const campos = {
        punto_norma: punto,
        descripcion: datos.descripcion !== undefined ? String(datos.descripcion).trim() : prev.descripcion,
        descripcion_html: datos.descripcion_html !== undefined
            ? (sanitizarHtmlDescripcion(datos.descripcion_html) || htmlDesdeDescripcion(String(datos.descripcion || '').trim()))
            : (datos.descripcion !== undefined
                ? htmlDesdeDescripcion(String(datos.descripcion).trim())
                : prev.descripcion_html),
        tipo_evidencia: texto(datos.tipo_evidencia, prev.tipo_evidencia),
        periodicidad: texto(datos.periodicidad, prev.periodicidad),
        evidencia_requerida: texto(datos.evidencia_requerida, prev.evidencia_requerida),
        responsable: datos.responsable !== undefined
            ? normalizarResponsablePunto(datos.responsable)
            : normalizarResponsablePunto(prev.responsable),
        observaciones: texto(datos.observaciones, prev.observaciones),
        formato_nombre: quitarFormato ? null : texto(datos.formato_nombre, prev.formato_nombre),
        formato_archivo: quitarFormato ? null : prev.formato_archivo,
        formato_nombre_archivo: quitarFormato ? null : prev.formato_nombre_archivo
    };
    if (!campos.descripcion) {
        const err = new Error('La descripción es obligatoria');
        err.status = 400;
        throw err;
    }
    if (!campos.punto_norma) {
        const err = new Error('El punto de la norma es obligatorio');
        err.status = 400;
        throw err;
    }

    const conn = await pool.getConnection();
    try {
        await conn.beginTransaction();
        await conn.query(
            `UPDATE seg_normativa_requisito SET
                punto_norma = ?, descripcion = ?, descripcion_html = ?, tipo_evidencia = ?,
                periodicidad = ?, evidencia_requerida = ?, responsable = ?, observaciones = ?,
                formato_nombre = ?, formato_archivo = ?, formato_nombre_archivo = ?
             WHERE id = ? AND normativa_id = ?`,
            [
                campos.punto_norma, campos.descripcion, campos.descripcion_html, campos.tipo_evidencia,
                campos.periodicidad, campos.evidencia_requerida, campos.responsable, campos.observaciones,
                campos.formato_nombre, campos.formato_archivo, campos.formato_nombre_archivo,
                requisitoId, normativaId
            ]
        );

        const etiqueta = campos.punto_norma || requisitoId;
        for (const key of ['punto_norma', 'descripcion', 'tipo_evidencia', 'periodicidad', 'evidencia_requerida', 'responsable', 'formato_nombre']) {
            const antes = prev[key];
            const despues = campos[key];
            if (String(antes || '') !== String(despues || '')) {
                await registrarHistorial(conn, {
                    normativaId,
                    requisitoId,
                    accion: 'edicion_requisito',
                    campo: key,
                    valorAnterior: antes,
                    valorNuevo: despues,
                    detalle: `Punto ${etiqueta}`,
                    usuario
                });
            }
        }
        if (quitarFormato && prev.formato_archivo) {
            await registrarHistorial(conn, {
                normativaId,
                requisitoId,
                accion: 'edicion_requisito',
                campo: 'formato_archivo',
                valorAnterior: prev.formato_nombre_archivo || prev.formato_archivo,
                valorNuevo: null,
                detalle: `Plantilla retirada del punto ${etiqueta}`,
                usuario
            });
        }

        await conn.commit();
    } catch (e) {
        await conn.rollback();
        throw e;
    } finally {
        conn.release();
    }

    if (quitarFormato) borrarArchivoSeguro(prev.formato_archivo);

    const [updated] = await pool.query('SELECT * FROM seg_normativa_requisito WHERE id = ?', [requisitoId]);
    return mapRequisitoRow(updated[0]);
}

async function guardarImagenPortada(pool, id, archivo, usuario) {
    const normativa = await obtenerNormativa(pool, id);
    const ext = extensionPermitida(archivo?.originalname, EXT_IMAGEN);
    if (!archivo?.buffer || !ext) {
        const err = new Error('Use una imagen JPG, PNG o WebP.');
        err.status = 400;
        throw err;
    }
    asegurarCarpeta(DIR_PORTADAS);
    const nombre = `normativa-${id}${ext}`;
    const abs = path.join(DIR_PORTADAS, nombre);
    fs.writeFileSync(abs, archivo.buffer);
    for (const otra of ['.jpg', '.png', '.webp']) {
        if (otra === ext) continue;
        const vieja = path.join(DIR_PORTADAS, `normativa-${id}${otra}`);
        if (fs.existsSync(vieja)) fs.unlinkSync(vieja);
    }
    const publica = rutaPublica(abs);
    const conn = await pool.getConnection();
    try {
        await conn.beginTransaction();
        await conn.query('UPDATE seg_normativa SET imagen_portada = ? WHERE id = ?', [publica, id]);
        await registrarHistorial(conn, {
            normativaId: id,
            accion: 'edicion_normativa',
            campo: 'imagen_portada',
            valorAnterior: normativa.imagen_portada,
            valorNuevo: publica,
            detalle: `Portada de ${normativa.codigo}`,
            usuario
        });
        await conn.commit();
    } catch (e) {
        await conn.rollback();
        throw e;
    } finally {
        conn.release();
    }
    return obtenerNormativa(pool, id);
}

async function quitarImagenPortada(pool, id, usuario) {
    const normativa = await obtenerNormativa(pool, id);
    if (!normativa.imagen_portada) return normativa;
    const conn = await pool.getConnection();
    try {
        await conn.beginTransaction();
        await conn.query('UPDATE seg_normativa SET imagen_portada = NULL WHERE id = ?', [id]);
        await registrarHistorial(conn, {
            normativaId: id,
            accion: 'edicion_normativa',
            campo: 'imagen_portada',
            valorAnterior: normativa.imagen_portada,
            valorNuevo: null,
            detalle: `Portada retirada de ${normativa.codigo}`,
            usuario
        });
        await conn.commit();
    } catch (e) {
        await conn.rollback();
        throw e;
    } finally {
        conn.release();
    }
    borrarArchivoSeguro(normativa.imagen_portada);
    return obtenerNormativa(pool, id);
}

async function guardarFormatoRequisito(pool, normativaId, requisitoId, archivo, formatoNombre, usuario) {
    const [rows] = await pool.query(
        'SELECT * FROM seg_normativa_requisito WHERE id = ? AND normativa_id = ? LIMIT 1',
        [requisitoId, normativaId]
    );
    if (!rows.length) {
        const err = new Error('Requisito no encontrado');
        err.status = 404;
        throw err;
    }
    const ext = extensionPermitida(archivo?.originalname, EXT_FORMATO);
    if (!archivo?.buffer || !ext) {
        const err = new Error('El formato guía debe ser PDF, Word o Excel.');
        err.status = 400;
        throw err;
    }
    const prev = rows[0];
    asegurarCarpeta(DIR_FORMATOS);
    const nombreDisco = `req-${requisitoId}-${Date.now()}${ext}`;
    const abs = path.join(DIR_FORMATOS, nombreDisco);
    fs.writeFileSync(abs, archivo.buffer);
    const publica = rutaPublica(abs);
    const visible = nombreVisible(archivo.originalname);
    const nombre = String(formatoNombre || '').trim() || prev.formato_nombre || visible.replace(/\.[^.]+$/, '');
    const conn = await pool.getConnection();
    try {
        await conn.beginTransaction();
        await conn.query(
            `UPDATE seg_normativa_requisito
             SET formato_nombre = ?, formato_archivo = ?, formato_nombre_archivo = ?
             WHERE id = ? AND normativa_id = ?`,
            [nombre.slice(0, 200), publica, visible, requisitoId, normativaId]
        );
        await registrarHistorial(conn, {
            normativaId,
            requisitoId,
            accion: 'edicion_requisito',
            campo: 'formato_archivo',
            valorAnterior: prev.formato_nombre_archivo,
            valorNuevo: visible,
            detalle: `Plantilla ligada al punto ${formatearPuntoNorma(prev.punto_norma) || requisitoId}`,
            usuario
        });
        await conn.commit();
    } catch (e) {
        await conn.rollback();
        borrarArchivoSeguro(publica);
        throw e;
    } finally {
        conn.release();
    }
    if (prev.formato_archivo && prev.formato_archivo !== publica) borrarArchivoSeguro(prev.formato_archivo);
    const [updated] = await pool.query('SELECT * FROM seg_normativa_requisito WHERE id = ?', [requisitoId]);
    return mapRequisitoRow(updated[0]);
}

async function contarImagenesReferencia(pool, requisitoId) {
    const [rows] = await pool.query(
        'SELECT COUNT(*) AS total FROM seg_normativa_requisito_imagen WHERE requisito_id = ?',
        [requisitoId]
    );
    return Number(rows[0]?.total || 0);
}

async function guardarImagenesReferencia(pool, normativaId, requisitoId, archivos, usuario) {
    const [rows] = await pool.query(
        'SELECT id, punto_norma FROM seg_normativa_requisito WHERE id = ? AND normativa_id = ? LIMIT 1',
        [requisitoId, normativaId]
    );
    if (!rows.length) {
        const err = new Error('Requisito no encontrado');
        err.status = 404;
        throw err;
    }
    const lista = (archivos || []).filter((a) => a && a.buffer);
    if (!lista.length) {
        const err = new Error('Seleccione al menos una imagen.');
        err.status = 400;
        throw err;
    }
    const actuales = await contarImagenesReferencia(pool, requisitoId);
    if (actuales + lista.length > MAX_IMAGENES_REFERENCIA) {
        const err = new Error(`Cada punto admite hasta ${MAX_IMAGENES_REFERENCIA} imágenes de referencia.`);
        err.status = 400;
        throw err;
    }
    asegurarCarpeta(DIR_REFERENCIAS);
    const guardadas = [];
    for (let i = 0; i < lista.length; i += 1) {
        const archivo = lista[i];
        const ext = extensionPermitida(archivo.originalname, EXT_IMAGEN);
        if (!ext) {
            for (const previa of guardadas) borrarArchivoSeguro(previa);
            const err = new Error('Las imágenes de referencia deben ser JPG, PNG o WebP.');
            err.status = 400;
            throw err;
        }
        const nombreDisco = `ref-${requisitoId}-${Date.now()}-${i}${ext}`;
        const abs = path.join(DIR_REFERENCIAS, nombreDisco);
        fs.writeFileSync(abs, archivo.buffer);
        guardadas.push(rutaPublica(abs));
    }
    const conn = await pool.getConnection();
    try {
        await conn.beginTransaction();
        let orden = actuales;
        for (let i = 0; i < guardadas.length; i += 1) {
            orden += 1;
            const visible = nombreVisible(lista[i].originalname);
            await conn.query(
                `INSERT INTO seg_normativa_requisito_imagen
                 (normativa_id, requisito_id, ruta, nombre, orden)
                 VALUES (?, ?, ?, ?, ?)`,
                [normativaId, requisitoId, guardadas[i], visible, orden]
            );
        }
        await registrarHistorial(conn, {
            normativaId,
            requisitoId,
            accion: 'edicion_requisito',
            campo: 'imagen_referencia',
            detalle: `Imagen de referencia en el punto ${formatearPuntoNorma(rows[0].punto_norma) || requisitoId}`,
            valorNuevo: String(guardadas.length),
            usuario
        });
        await conn.commit();
    } catch (e) {
        await conn.rollback();
        for (const ruta of guardadas) borrarArchivoSeguro(ruta);
        throw e;
    } finally {
        conn.release();
    }
    const requisitos = await listarRequisitos(pool, normativaId);
    return requisitos.find((r) => r.id === requisitoId) || null;
}

async function quitarImagenReferencia(pool, normativaId, requisitoId, imagenId, usuario) {
    const [rows] = await pool.query(
        `SELECT i.id, i.ruta, i.nombre, r.punto_norma
         FROM seg_normativa_requisito_imagen i
         INNER JOIN seg_normativa_requisito r ON r.id = i.requisito_id
         WHERE i.id = ? AND i.requisito_id = ? AND i.normativa_id = ?
         LIMIT 1`,
        [imagenId, requisitoId, normativaId]
    );
    if (!rows.length) {
        const err = new Error('Imagen no encontrada');
        err.status = 404;
        throw err;
    }
    const img = rows[0];
    const conn = await pool.getConnection();
    try {
        await conn.beginTransaction();
        await conn.query('DELETE FROM seg_normativa_requisito_imagen WHERE id = ?', [imagenId]);
        await registrarHistorial(conn, {
            normativaId,
            requisitoId,
            accion: 'edicion_requisito',
            campo: 'imagen_referencia',
            detalle: `Imagen retirada del punto ${formatearPuntoNorma(img.punto_norma) || requisitoId}`,
            valorAnterior: img.nombre,
            usuario
        });
        await conn.commit();
    } catch (e) {
        await conn.rollback();
        throw e;
    } finally {
        conn.release();
    }
    borrarArchivoSeguro(img.ruta);
    const requisitos = await listarRequisitos(pool, normativaId);
    return requisitos.find((r) => r.id === requisitoId) || null;
}

async function eliminarNormativa(pool, id) {
    const normativa = await obtenerNormativa(pool, id);
    const [reqs] = await pool.query(
        'SELECT formato_archivo FROM seg_normativa_requisito WHERE normativa_id = ?',
        [id]
    );
    const [imgs] = await pool.query(
        'SELECT ruta FROM seg_normativa_requisito_imagen WHERE normativa_id = ?',
        [id]
    );
    const [result] = await pool.query('DELETE FROM seg_normativa WHERE id = ?', [id]);
    if (!result.affectedRows) {
        const err = new Error('Normativa no encontrada');
        err.status = 404;
        throw err;
    }
    borrarArchivoSeguro(normativa.imagen_portada);
    for (const req of reqs) borrarArchivoSeguro(req.formato_archivo);
    for (const img of imgs) borrarArchivoSeguro(img.ruta);
    return { eliminada: true };
}

/** Registra historial de importación para datos de prueba sin historial previo */
async function asegurarHistorialImportacionInicial(pool) {
    const [normativas] = await pool.query(
        `SELECT n.id, n.codigo, n.importado_por, n.importado_perfil, n.importado_en, n.total_requisitos
         FROM seg_normativa n`
    );
    for (const n of normativas) {
        const [hist] = await pool.query(
            'SELECT id FROM seg_normativa_historial WHERE normativa_id = ? LIMIT 1',
            [n.id]
        );
        if (hist.length) continue;

        const nombre = n.importado_por === 'seed-script' ? 'Super Administrador' : (n.importado_por || 'Super Administrador');
        const perfil = n.importado_perfil || (n.importado_por === 'seed-script' ? 'Super Administrador' : 'Administrador');

        if (n.importado_por === 'seed-script') {
            await pool.query(
                'UPDATE seg_normativa SET importado_por = ?, importado_perfil = ? WHERE id = ?',
                [nombre, perfil, n.id]
            );
        }

        await pool.query(
            `INSERT INTO seg_normativa_historial
             (normativa_id, accion, detalle, usuario_nombre, usuario_perfil, creado_en)
             VALUES (?, 'importacion', ?, ?, ?, COALESCE(?, NOW()))`,
            [
                n.id,
                `Importación inicial de ${n.codigo} (${n.total_requisitos} requisitos)`,
                nombre,
                perfil,
                n.importado_en
            ]
        );
    }
}

module.exports = {
    asegurarTablas,
    asegurarHistorialImportacionInicial,
    listarCatalogo,
    obtenerNormativa,
    listarRequisitos,
    listarHistorial,
    obtenerResumen,
    importarDesdeExcel,
    actualizarNormativa,
    actualizarRequisito,
    guardarImagenPortada,
    quitarImagenPortada,
    guardarFormatoRequisito,
    guardarImagenesReferencia,
    quitarImagenReferencia,
    eliminarNormativa,
    parsearPlantillaExcel,
    formatearPuntoNorma,
    normalizarResponsablePunto,
    contextoUsuario,
    categoriaDesdeNumero
};
