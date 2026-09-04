// =====================================================
// BIZNAGA R&T — Seguridad · Catálogo de normativas (BD normativas)
// Importación desde plantillas Excel (formato NOM-001-STPS-2008)
// =====================================================

const ExcelJS = require('exceljs');
const crypto = require('crypto');

const FILA_INICIO_DATOS = 5;
const COL = {
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

const RE_NOM = /NOM-(\d{3})-([A-Z0-9]+)-(\d{4})/i;

function escapeHtml(text) {
    return String(text || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

function limpiarTexto(value) {
    if (value === null || value === undefined) return '';
    if (typeof value === 'string') return value.replace(/\s+/g, ' ').trim();
    if (typeof value === 'number' || typeof value === 'boolean') return String(value).trim();
    if (value instanceof Date) return value.toISOString().slice(0, 10);
    if (value && typeof value === 'object') {
        if (Array.isArray(value.richText)) {
            return value.richText.map((p) => p.text || '').join('').replace(/\s+/g, ' ').trim();
        }
        if (value.text) return limpiarTexto(value.text);
        if (value.result !== undefined) return limpiarTexto(value.result);
        if (value.hyperlink && value.text) return limpiarTexto(value.text);
    }
    return String(value).replace(/\s+/g, ' ').trim();
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
        const t = value.trim();
        return t ? escapeHtml(t) : null;
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
        return html.trim() || null;
    }
    const plain = limpiarTexto(value);
    return plain ? escapeHtml(plain) : null;
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

function parsearAplica(value) {
    const txt = limpiarTexto(value).toLowerCase();
    if (!txt) return null;
    if (txt === 'si' || txt === 'sí' || txt === 'aplica' || txt === 'x') return 1;
    if (txt === 'no' || txt === 'no aplica' || txt === 'n/a') return 0;
    return null;
}

function parsearIndicador(value) {
    const n = Number(limpiarTexto(value));
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

function extraerTituloDesdeBloque(bloque, codigo) {
    const idx = bloque.indexOf(codigo);
    if (idx < 0) return codigo;
    let rest = bloque.slice(idx + codigo.length).trim();
    const dupIdx = rest.search(/\bNORMA\s+Oficial\b/i);
    if (dupIdx > 0) rest = rest.slice(0, dupIdx).trim();
    rest = rest.replace(/\s+/g, ' ').trim();
    if (!rest) return codigo;
    if (rest.length > 480) rest = `${rest.slice(0, 477).trim()}…`;
    return rest;
}

function extraerMetadatosNorma(ws) {
    let bloque = '';
    for (let c = 1; c <= 20; c++) {
        bloque += ' ' + limpiarTexto(ws.getRow(1).getCell(c).value);
    }
    bloque = bloque.replace(/\s+/g, ' ').trim();
    const match = bloque.match(RE_NOM);
    if (!match) {
        const err = new Error('No se detectó clave NOM en la plantilla (fila 1). Verifique el formato del archivo.');
        err.status = 400;
        throw err;
    }
    const numero = parseInt(match[1], 10);
    const codigo = `NOM-${match[1]}-${match[2].toUpperCase()}-${match[3]}`;
    const titulo = extraerTituloDesdeBloque(bloque, codigo);
    return {
        codigo,
        titulo,
        autoridad: match[2].toUpperCase(),
        anio: parseInt(match[3], 10),
        numero,
        categoria_id: categoriaDesdeNumero(numero)
    };
}

function parsearFilaRequisito(ws, rowNum) {
    const row = ws.getRow(rowNum);
    const celdaPunto = row.getCell(COL.PUNTO).value;
    const celdaDesc = row.getCell(COL.DESCRIPCION).value;
    const numeroItem = limpiarTexto(row.getCell(COL.ITEM).value);
    const punto = formatearPuntoNorma(celdaPunto);
    const descripcion = limpiarTexto(celdaDesc);
    const descripcionHtml = celdaAHtml(celdaDesc);
    if (!numeroItem && !punto && !descripcion) return null;
    if (!punto && !descripcion) return null;

    return {
        numero_item: numeroItem ? parseInt(numeroItem, 10) || null : null,
        punto_norma: punto || null,
        descripcion: descripcion || null,
        descripcion_html: descripcionHtml,
        aplica: parsearAplica(row.getCell(COL.APLICA).value),
        tipo_evidencia: limpiarTexto(row.getCell(COL.TIPO_EVIDENCIA).value) || null,
        periodicidad: limpiarTexto(row.getCell(COL.PERIODICIDAD).value) || null,
        accion_prev_conservar: parsearAccionMarcada(row.getCell(COL.PREV_CONSERVAR).value),
        accion_prev_mejorar: parsearAccionMarcada(row.getCell(COL.PREV_MEJORAR).value),
        accion_prev_actualizar: parsearAccionMarcada(row.getCell(COL.PREV_ACTUALIZAR).value),
        accion_corr_complementar: parsearAccionMarcada(row.getCell(COL.CORR_COMPLEMENTAR).value),
        accion_corr_corregir: parsearAccionMarcada(row.getCell(COL.CORR_CORREGIR).value),
        accion_corr_realizar: parsearAccionMarcada(row.getCell(COL.CORR_REALIZAR).value),
        fecha_inicio: parsearFecha(row.getCell(COL.FECHA_INICIO).value),
        fecha_terminacion: parsearFecha(row.getCell(COL.FECHA_TERMINACION).value),
        responsable: limpiarTexto(row.getCell(COL.RESPONSABLE).value) || null,
        indicador_avance: parsearIndicador(row.getCell(COL.INDICADOR_AVANCE).value),
        evidencia_requerida: limpiarTexto(row.getCell(COL.EVIDENCIA_REQUERIDA).value) || null,
        observaciones: limpiarTexto(row.getCell(COL.OBSERVACIONES).value) || null,
        orden: rowNum - FILA_INICIO_DATOS + 1
    };
}

async function parsearPlantillaExcel(buffer) {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buffer);
    const ws = wb.worksheets[0];
    if (!ws) {
        const err = new Error('El archivo Excel no contiene hojas de cálculo.');
        err.status = 400;
        throw err;
    }

    const meta = extraerMetadatosNorma(ws);
    const requisitos = [];
    for (let r = FILA_INICIO_DATOS; r <= ws.rowCount; r++) {
        const req = parsearFilaRequisito(ws, r);
        if (req) requisitos.push(req);
    }
    if (!requisitos.length) {
        const err = new Error('No se encontraron requisitos en la plantilla (desde fila 5).');
        err.status = 400;
        throw err;
    }

    return { meta, requisitos };
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
    await addColumnIfNotExists(pool, 'seg_normativa_requisito', 'descripcion_html', 'MEDIUMTEXT NULL');

    await normalizarPuntosExistentes(pool);
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
        responsable: row.responsable,
        indicador_avance: row.indicador_avance,
        evidencia_requerida: row.evidencia_requerida,
        observaciones: row.observaciones,
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
                n.importado_en, n.updated_at
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
                total_requisitos, importado_por, importado_perfil, importado_en, updated_at
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
        where += ' AND (punto_norma LIKE ? OR descripcion LIKE ? OR responsable LIKE ?)';
        const q = `%${busqueda.trim()}%`;
        params.push(q, q, q);
    }
    const [rows] = await pool.query(
        `SELECT * FROM seg_normativa_requisito ${where} ORDER BY orden ASC, id ASC`,
        params
    );
    return rows.map(mapRequisitoRow);
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
    const { meta, requisitos } = await parsearPlantillaExcel(buffer);
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
        if (esReimport) {
            normativaId = existentes[0].id;
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
    const campos = {
        descripcion: datos.descripcion !== undefined ? String(datos.descripcion).trim() : prev.descripcion,
        descripcion_html: datos.descripcion_html !== undefined
            ? datos.descripcion_html
            : (datos.descripcion !== undefined ? escapeHtml(datos.descripcion) : prev.descripcion_html),
        tipo_evidencia: datos.tipo_evidencia !== undefined ? (String(datos.tipo_evidencia).trim() || null) : prev.tipo_evidencia,
        periodicidad: datos.periodicidad !== undefined ? (String(datos.periodicidad).trim() || null) : prev.periodicidad,
        responsable: datos.responsable !== undefined ? (String(datos.responsable).trim() || null) : prev.responsable,
        evidencia_requerida: datos.evidencia_requerida !== undefined ? (String(datos.evidencia_requerida).trim() || null) : prev.evidencia_requerida,
        observaciones: datos.observaciones !== undefined ? (String(datos.observaciones).trim() || null) : prev.observaciones
    };

    const conn = await pool.getConnection();
    try {
        await conn.beginTransaction();
        await conn.query(
            `UPDATE seg_normativa_requisito SET
                descripcion = ?, descripcion_html = ?, tipo_evidencia = ?, periodicidad = ?,
                responsable = ?, evidencia_requerida = ?, observaciones = ?
             WHERE id = ? AND normativa_id = ?`,
            [
                campos.descripcion, campos.descripcion_html, campos.tipo_evidencia,
                campos.periodicidad, campos.responsable, campos.evidencia_requerida,
                campos.observaciones, requisitoId, normativaId
            ]
        );

        const punto = formatearPuntoNorma(prev.punto_norma);
        for (const key of Object.keys(campos)) {
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
                    detalle: `Punto ${punto || requisitoId}`,
                    usuario
                });
            }
        }

        await conn.commit();
    } catch (e) {
        await conn.rollback();
        throw e;
    } finally {
        conn.release();
    }

    const [updated] = await pool.query('SELECT * FROM seg_normativa_requisito WHERE id = ?', [requisitoId]);
    return mapRequisitoRow(updated[0]);
}

async function eliminarNormativa(pool, id) {
    const [result] = await pool.query('DELETE FROM seg_normativa WHERE id = ?', [id]);
    if (!result.affectedRows) {
        const err = new Error('Normativa no encontrada');
        err.status = 404;
        throw err;
    }
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
    eliminarNormativa,
    parsearPlantillaExcel,
    formatearPuntoNorma,
    contextoUsuario,
    categoriaDesdeNumero
};
