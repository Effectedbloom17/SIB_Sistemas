/**
 * Diseño e Innovación · Cotización de proyecto (multi-línea) — biznaga_sgc.
 */
const driveService = require('./driveService');
const innovacionMaterialService = require('./innovacionMaterialService');
const innovacionSignService = require('./innovacionSignService');

const PLANTILLA_SHEET_ID = '1ddV3h415V6He6pS4nMQjvhiV8baFbah4cL3J5Ic3l8g';
const IVA_TASA = 0.16;

const FORMAS_VALIDAS = new Set([
    'circular',
    'rectangular',
    'cuadrada',
    'hexagonal',
    'octogonal',
    'personalizado'
]);

const TIPOS_COTIZACION_VALIDOS = new Set(['produccion', 'cliente']);

const CLASIFICACION_LABELS = {
    advertencia: 'Advertencia',
    obligacion: 'Obligación',
    prohibicion: 'Prohibición',
    equipo_incendios: 'Equipo contra incendios',
    condicion_segura: 'Condición segura',
    personalizado: 'Personalizado'
};

function sanitizarTexto(valor, max = 255) {
    return String(valor || '')
        .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '')
        .trim()
        .slice(0, max);
}

function normalizarForma(forma) {
    const f = String(forma || '').trim().toLowerCase();
    if (!FORMAS_VALIDAS.has(f)) {
        throw new Error('Forma geométrica no válida.');
    }
    return f;
}

function normalizarTipoCotizacion(tipo) {
    const valor = String(tipo || 'produccion').trim().toLowerCase();
    if (!TIPOS_COTIZACION_VALIDOS.has(valor)) {
        throw new Error('Tipo de cotización no válido. Use producción o cliente.');
    }
    return valor;
}

function numeroPositivo(valor, nombreCampo) {
    const n = Number(valor);
    if (!Number.isFinite(n) || n <= 0) {
        throw new Error(`${nombreCampo} debe ser un número mayor a cero.`);
    }
    return Math.round(n * 100) / 100;
}

function numeroNoNegativo(valor, nombreCampo) {
    if (valor == null || valor === '') {
        return 0;
    }
    const n = Number(valor);
    if (!Number.isFinite(n) || n < 0) {
        throw new Error(`${nombreCampo} debe ser un número mayor o igual a cero.`);
    }
    return Math.round(n * 100) / 100;
}

function redondear2(n) {
    return Math.round(Number(n) * 100) / 100;
}

function formatearTamanoTexto(largoCm, anchoCm) {
    return `${largoCm} × ${anchoCm} cm`;
}

function etiquetaClasificacion(clasificacion) {
    if (!clasificacion) {
        return '';
    }
    return CLASIFICACION_LABELS[clasificacion] || clasificacion;
}

function formatearMaterialesTexto(materiales) {
    if (!Array.isArray(materiales) || !materiales.length) {
        return '';
    }
    return materiales.join(', ');
}

async function normalizarMateriales(pool, materiales) {
    let lista = materiales;
    if (typeof lista === 'string') {
        try {
            lista = JSON.parse(lista);
        } catch {
            lista = lista.split(',').map(s => s.trim()).filter(Boolean);
        }
    }
    if (!Array.isArray(lista) || lista.length === 0) {
        throw new Error('Seleccione al menos un material.');
    }
    const slugsActivos = await innovacionMaterialService.obtenerSlugsActivos(pool);
    const normalizados = [...new Set(lista.map(m => String(m).trim().toLowerCase()))];
    for (const m of normalizados) {
        if (!slugsActivos.has(m)) {
            throw new Error(`Material no válido: ${m}`);
        }
    }
    return normalizados;
}

function parseMaterialesJson(raw) {
    try {
        const parsed = typeof raw === 'string' ? JSON.parse(raw || '[]') : raw;
        return Array.isArray(parsed) ? parsed : [];
    } catch {
        return [];
    }
}

function formatearLinea(row) {
    if (!row) {
        return null;
    }
    return {
        id: row.id,
        proyectoId: row.proyecto_id,
        orden: Number(row.orden),
        signId: row.sign_id,
        nombreSenal: row.nombre_senal || '',
        clasificacion: row.clasificacion || null,
        forma: row.forma,
        formaPersonalizadoTexto: row.forma_personalizado_texto || null,
        distanciaVisualizacionM: row.distancia_visualizacion_m != null
            ? Number(row.distancia_visualizacion_m)
            : null,
        largoCm: Number(row.largo_cm),
        anchoCm: Number(row.ancho_cm),
        tamanoTexto: row.tamano_texto || formatearTamanoTexto(row.largo_cm, row.ancho_cm),
        materiales: parseMaterialesJson(row.materiales_json),
        cantidad: Number(row.cantidad),
        costoUnitario: Number(row.costo_unitario),
        subtotal: Number(row.subtotal),
        notas: row.notas || null
    };
}

function formatearProyecto(row, lineas = []) {
    if (!row) {
        return null;
    }
    const activo = row.activo == null ? true : Number(row.activo) === 1;
    return {
        id: row.id,
        folio: row.folio,
        empresaId: row.empresa_id != null ? Number(row.empresa_id) : null,
        empresaNombre: row.empresa_nombre || '',
        nombreProyecto: row.nombre_proyecto || '',
        fechaCotizacion: row.fecha_cotizacion,
        tipoCotizacion: row.tipo_cotizacion || 'produccion',
        subtotal: Number(row.subtotal),
        iva: Number(row.iva),
        totalNeto: Number(row.total_neto),
        driveFileId: row.drive_file_id || null,
        webViewLink: row.web_view_link || null,
        creadoPor: row.creado_por || null,
        fechaCreacion: row.created_at,
        activo,
        desactivadoPor: row.desactivado_por || null,
        fechaDesactivacion: row.desactivado_at || null,
        lineas: lineas.map(formatearLinea)
    };
}

async function asegurarColumnaActivo(pool) {
    try {
        await pool.query(`
            ALTER TABLE innovacion_cotizacion_proyecto
            ADD COLUMN activo TINYINT(1) NOT NULL DEFAULT 1 AFTER creado_por
        `);
    } catch (err) {
        const msg = String(err?.message || '');
        if (!msg.includes('Duplicate column')) {
            throw err;
        }
    }
    try {
        await pool.query(`
            ALTER TABLE innovacion_cotizacion_proyecto
            ADD COLUMN desactivado_por VARCHAR(128) NULL AFTER activo
        `);
    } catch (err) {
        const msg = String(err?.message || '');
        if (!msg.includes('Duplicate column')) {
            throw err;
        }
    }
    try {
        await pool.query(`
            ALTER TABLE innovacion_cotizacion_proyecto
            ADD COLUMN desactivado_at DATETIME NULL AFTER desactivado_por
        `);
    } catch (err) {
        const msg = String(err?.message || '');
        if (!msg.includes('Duplicate column')) {
            throw err;
        }
    }
    try {
        await pool.query(`
            ALTER TABLE innovacion_cotizacion_proyecto
            ADD KEY idx_innovacion_cotizacion_activo (activo)
        `);
    } catch (err) {
        // Índice ya existe
    }
}

async function asegurarTablas(pool) {
    await pool.query(`
        CREATE TABLE IF NOT EXISTS innovacion_cotizacion_proyecto (
            id INT AUTO_INCREMENT PRIMARY KEY,
            folio VARCHAR(16) NOT NULL,
            empresa_id INT NULL,
            empresa_nombre VARCHAR(255) NOT NULL,
            nombre_proyecto VARCHAR(255) NOT NULL,
            fecha_cotizacion DATE NOT NULL,
            tipo_cotizacion VARCHAR(16) NOT NULL DEFAULT 'produccion',
            subtotal DECIMAL(14,2) NOT NULL DEFAULT 0,
            iva DECIMAL(14,2) NOT NULL DEFAULT 0,
            total_neto DECIMAL(14,2) NOT NULL DEFAULT 0,
            drive_file_id VARCHAR(128) NULL,
            web_view_link VARCHAR(512) NULL,
            creado_por VARCHAR(128) NULL,
            activo TINYINT(1) NOT NULL DEFAULT 1,
            desactivado_por VARCHAR(128) NULL,
            desactivado_at DATETIME NULL,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            UNIQUE KEY uq_innovacion_cotizacion_folio (folio),
            KEY idx_innovacion_cotizacion_created (created_at),
            KEY idx_innovacion_cotizacion_activo (activo)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    await pool.query(`
        CREATE TABLE IF NOT EXISTS innovacion_cotizacion_linea (
            id INT AUTO_INCREMENT PRIMARY KEY,
            proyecto_id INT NOT NULL,
            orden INT NOT NULL DEFAULT 1,
            sign_id INT NOT NULL,
            nombre_senal VARCHAR(255) NOT NULL,
            clasificacion VARCHAR(64) NULL,
            forma VARCHAR(32) NOT NULL,
            forma_personalizado_texto VARCHAR(500) NULL,
            distancia_visualizacion_m DECIMAL(8,2) NULL,
            largo_cm DECIMAL(10,2) NOT NULL,
            ancho_cm DECIMAL(10,2) NOT NULL,
            tamano_texto VARCHAR(64) NOT NULL,
            materiales_json JSON NOT NULL,
            cantidad INT NOT NULL,
            costo_unitario DECIMAL(12,2) NOT NULL DEFAULT 0,
            subtotal DECIMAL(14,2) NOT NULL DEFAULT 0,
            notas TEXT NULL,
            KEY idx_innovacion_cotizacion_linea_proyecto (proyecto_id),
            KEY idx_innovacion_cotizacion_linea_sign (sign_id),
            CONSTRAINT fk_innovacion_cotizacion_linea_proyecto
                FOREIGN KEY (proyecto_id) REFERENCES innovacion_cotizacion_proyecto(id)
                ON DELETE CASCADE ON UPDATE CASCADE
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    await asegurarColumnaActivo(pool);
}

async function siguienteFolio(pool) {
    const [rows] = await pool.query(`
        SELECT folio FROM innovacion_cotizacion_proyecto
        ORDER BY CAST(folio AS UNSIGNED) DESC, id DESC
        LIMIT 1
    `);
    const actual = rows[0]?.folio ? parseInt(rows[0].folio, 10) : 0;
    const siguiente = (Number.isFinite(actual) ? actual : 0) + 1;
    return String(siguiente).padStart(4, '0');
}

async function obtenerLineasProyecto(pool, proyectoId) {
    const [rows] = await pool.query(
        `SELECT * FROM innovacion_cotizacion_linea
         WHERE proyecto_id = ?
         ORDER BY orden ASC, id ASC`,
        [proyectoId]
    );
    return rows;
}

async function obtenerProyecto(pool, id) {
    const [rows] = await pool.query(
        'SELECT * FROM innovacion_cotizacion_proyecto WHERE id = ? LIMIT 1',
        [id]
    );
    if (!rows[0]) {
        return null;
    }
    const lineas = await obtenerLineasProyecto(pool, id);
    return formatearProyecto(rows[0], lineas);
}

async function listarProyectos(pool, opciones = {}) {
    const incluirInactivas = opciones.incluirInactivas === true;
    const [proyectos] = await pool.query(`
        SELECT * FROM innovacion_cotizacion_proyecto
        WHERE (? = 1 OR COALESCE(activo, 1) = 1)
        ORDER BY created_at DESC, id DESC
    `, [incluirInactivas ? 1 : 0]);
    if (!proyectos.length) {
        return [];
    }
    const ids = proyectos.map(p => p.id);
    const [lineas] = await pool.query(
        `SELECT * FROM innovacion_cotizacion_linea
         WHERE proyecto_id IN (?)
         ORDER BY proyecto_id ASC, orden ASC, id ASC`,
        [ids]
    );
    const porProyecto = new Map();
    for (const linea of lineas) {
        if (!porProyecto.has(linea.proyecto_id)) {
            porProyecto.set(linea.proyecto_id, []);
        }
        porProyecto.get(linea.proyecto_id).push(linea);
    }
    return proyectos.map(p => formatearProyecto(p, porProyecto.get(p.id) || []));
}

async function construirLineasValidadas(pool, lineasPayload) {
    if (!Array.isArray(lineasPayload) || lineasPayload.length === 0) {
        throw new Error('Agregue al menos una línea de cotización.');
    }

    const lineas = [];
    for (let i = 0; i < lineasPayload.length; i++) {
        const raw = lineasPayload[i] || {};
        const signId = Number(raw.sign_id ?? raw.signId);
        if (!Number.isInteger(signId) || signId <= 0) {
            throw new Error(`Línea ${i + 1}: seleccione una señalización válida.`);
        }

        const sign = await innovacionSignService.obtenerSign(pool, signId);
        if (!sign) {
            throw new Error(`Línea ${i + 1}: la señalización seleccionada no existe.`);
        }

        const forma = normalizarForma(raw.forma);
        let formaPersonalizadoTexto = null;
        if (forma === 'personalizado') {
            formaPersonalizadoTexto = sanitizarTexto(
                raw.forma_personalizado_texto ?? raw.formaPersonalizadoTexto,
                500
            );
            if (!formaPersonalizadoTexto) {
                throw new Error(`Línea ${i + 1}: describa la forma personalizada.`);
            }
        }

        const largoCm = numeroPositivo(raw.largo_cm ?? raw.largoCm, `Línea ${i + 1}: largo`);
        const anchoCm = numeroPositivo(raw.ancho_cm ?? raw.anchoCm, `Línea ${i + 1}: ancho`);
        const cantidad = Number(raw.cantidad);
        if (!Number.isInteger(cantidad) || cantidad <= 0) {
            throw new Error(`Línea ${i + 1}: la cantidad debe ser un entero mayor a cero.`);
        }

        let distanciaVisualizacionM = null;
        if (raw.distancia_visualizacion_m != null || raw.distanciaVisualizacionM != null) {
            distanciaVisualizacionM = numeroPositivo(
                raw.distancia_visualizacion_m ?? raw.distanciaVisualizacionM,
                `Línea ${i + 1}: distancia de visualización`
            );
        }

        const materiales = await normalizarMateriales(pool, raw.materiales);
        const costoUnitario = Object.prototype.hasOwnProperty.call(raw, 'costo_unitario')
            || Object.prototype.hasOwnProperty.call(raw, 'costoUnitario')
            ? numeroNoNegativo(raw.costo_unitario ?? raw.costoUnitario, `Línea ${i + 1}: costo unitario`)
            : numeroNoNegativo(sign.costoUnitario, `Línea ${i + 1}: costo unitario`);

        const subtotal = redondear2(cantidad * costoUnitario);
        const notasRaw = raw.notas ?? null;
        const notas = notasRaw != null && String(notasRaw).trim()
            ? sanitizarTexto(notasRaw, 4000)
            : null;

        lineas.push({
            orden: i + 1,
            signId,
            nombreSenal: sign.nombreSenal || sign.descripcion || `Señal ${signId}`,
            clasificacion: sign.clasificacion || null,
            forma,
            formaPersonalizadoTexto,
            distanciaVisualizacionM,
            largoCm,
            anchoCm,
            tamanoTexto: formatearTamanoTexto(largoCm, anchoCm),
            materiales,
            cantidad,
            costoUnitario,
            subtotal,
            notas
        });
    }
    return lineas;
}

function quoteSheetTitle(title) {
    return `'${String(title || '').replace(/'/g, "''")}'`;
}

async function resolverHojaPlantilla(spreadsheetId) {
    const hojas = await driveService.obtenerMetadatosHojasGoogleSheet(spreadsheetId);
    if (!hojas.length) {
        throw new Error('El spreadsheet de cotizaciones no tiene hojas.');
    }
    const preferidas = [
        'Plantilla',
        'Plantilla Cotización',
        'Plantilla Cotizacion',
        'Cotización Señales',
        'Cotizacion Senales',
        'Cotización Señales'
    ];
    for (const nombre of preferidas) {
        const found = hojas.find(
            (h) => String(h.title || '').trim().toLowerCase() === nombre.toLowerCase()
        );
        if (found) {
            return found;
        }
    }
    const porPrefijo = hojas.find((h) =>
        /^plantilla/i.test(String(h.title || '').trim())
    );
    if (porPrefijo) {
        return porPrefijo;
    }
    return hojas[0];
}

async function rellenarSheetCotizacion(proyecto, lineas) {
    const spreadsheetId = PLANTILLA_SHEET_ID;
    const plantilla = await resolverHojaPlantilla(spreadsheetId);
    const nombreBase = `${proyecto.folio}_${sanitizarTexto(proyecto.nombreProyecto, 60)
        .replace(/[/\\?*:[\]]/g, '_')
        .replace(/\s+/g, '_')
        .slice(0, 60) || 'proyecto'}`;

    const dup = await driveService.duplicarHojaGoogleSheet(
        spreadsheetId,
        plantilla.title,
        nombreBase
    );

    const fechaStr = proyecto.fechaCotizacion
        ? String(proyecto.fechaCotizacion).slice(0, 10)
        : '';
    const primera = lineas[0];

    const reemplazos = [
        ['{{razon_social}}', proyecto.empresaNombre || ''],
        ['{{nom_proyecto}}', proyecto.nombreProyecto || ''],
        ['{{fecha}}', fechaStr],
        ['{{num_folio}}', proyecto.folio || ''],
        ['{{No.}}', '1'],
        ['{{imagen}}', primera?.nombreSenal || ''],
        ['{{descripcion}}', etiquetaClasificacion(primera?.clasificacion) || primera?.nombreSenal || ''],
        ['{{tamaño}}', primera?.tamanoTexto || ''],
        ['{{tamano}}', primera?.tamanoTexto || ''],
        ['{{material}}', formatearMaterialesTexto(primera?.materiales)],
        ['{{cantidad}}', String(primera?.cantidad ?? '')],
        ['{{costo_unitario}}', String(primera?.costoUnitario ?? '')],
        ['{{subtotal}}', String(primera?.subtotal ?? '')],
        ['{{subtotal_total}}', String(proyecto.subtotal ?? '')],
        ['{{iva}}', String(proyecto.iva ?? '')],
        ['{{total_neto}}', String(proyecto.totalNeto ?? '')],
        ['{{total}}', String(proyecto.totalNeto ?? '')]
    ];

    for (const [token, valor] of reemplazos) {
        try {
            await driveService.reemplazarTextoEnGoogleSheet(spreadsheetId, token, valor, {
                sheetId: dup.sheetId
            });
        } catch (err) {
            console.warn(`[INNOVACION-COTIZACION] No se pudo reemplazar ${token}: ${err.message}`);
        }
    }

    if (lineas.length > 1) {
        try {
            // Fila 4 (índice 3) es la primera de datos; insertar filas antes de totales (fila 5).
            await driveService.insertarFilasGoogleSheet(
                spreadsheetId,
                dup.sheetId,
                4,
                lineas.length - 1,
                { inheritFromBefore: true }
            );
        } catch (err) {
            console.warn(`[INNOVACION-COTIZACION] No se pudieron insertar filas: ${err.message}`);
        }
    }

    const sheetRef = quoteSheetTitle(dup.title);
    const valoresLineas = lineas.map((linea, idx) => [
        idx + 1,
        linea.nombreSenal || '',
        etiquetaClasificacion(linea.clasificacion) || linea.nombreSenal || '',
        linea.tamanoTexto || '',
        formatearMaterialesTexto(linea.materiales),
        linea.cantidad,
        linea.costoUnitario,
        linea.subtotal
    ]);

    const filaFin = 3 + valoresLineas.length;
    const actualizaciones = [
        {
            range: `${sheetRef}!B4:I${filaFin}`,
            values: valoresLineas
        },
        {
            range: `${sheetRef}!H${filaFin + 1}:I${filaFin + 3}`,
            values: [
                ['Subtotal', proyecto.subtotal],
                ['IVA', proyecto.iva],
                ['Total Neto', proyecto.totalNeto]
            ]
        }
    ];

    try {
        await driveService.actualizarCeldasGoogleSheet(spreadsheetId, actualizaciones);
    } catch (err) {
        console.warn(`[INNOVACION-COTIZACION] No se pudieron escribir filas de líneas: ${err.message}`);
    }

    const webViewLink =
        `https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit#gid=${dup.sheetId}`;

    return {
        driveFileId: spreadsheetId,
        sheetTitle: dup.title,
        sheetId: dup.sheetId,
        webViewLink
    };
}

async function exportarExcelHistorial() {
    const buffer = await driveService.exportarArchivoXLSX(PLANTILLA_SHEET_ID);
    if (!buffer || !Buffer.isBuffer(buffer)) {
        throw new Error('No se pudo exportar el Excel de cotizaciones.');
    }
    return buffer;
}

async function crearProyecto(pool, payload, usuario) {
    const empresaNombre = sanitizarTexto(payload.empresa_nombre ?? payload.empresaNombre, 255);
    if (!empresaNombre) {
        throw new Error('El nombre de la empresa es obligatorio.');
    }
    const nombreProyecto = sanitizarTexto(payload.nombre_proyecto ?? payload.nombreProyecto, 255);
    if (!nombreProyecto) {
        throw new Error('El nombre del proyecto es obligatorio.');
    }
    const fechaCotizacion = String(payload.fecha_cotizacion ?? payload.fechaCotizacion ?? '').trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(fechaCotizacion)) {
        throw new Error('La fecha de cotización debe tener formato YYYY-MM-DD.');
    }

    const tipoCotizacion = normalizarTipoCotizacion(
        payload.tipo_cotizacion ?? payload.tipoCotizacion
    );

    let empresaId = payload.empresa_id ?? payload.empresaId ?? null;
    if (empresaId != null && empresaId !== '') {
        empresaId = Number(empresaId);
        if (!Number.isInteger(empresaId) || empresaId <= 0) {
            throw new Error('empresa_id no es válido.');
        }
    } else {
        empresaId = null;
    }

    const lineas = await construirLineasValidadas(pool, payload.lineas);
    const subtotal = redondear2(lineas.reduce((acc, l) => acc + l.subtotal, 0));
    const iva = redondear2(subtotal * IVA_TASA);
    const totalNeto = redondear2(subtotal + iva);
    const folio = await siguienteFolio(pool);
    const creadoPor = sanitizarTexto(usuario, 128);

    const conexion = await pool.getConnection();
    let proyectoId;
    try {
        await conexion.beginTransaction();
        const [result] = await conexion.query(
            `INSERT INTO innovacion_cotizacion_proyecto
             (folio, empresa_id, empresa_nombre, nombre_proyecto, fecha_cotizacion, tipo_cotizacion,
              subtotal, iva, total_neto, creado_por)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                folio,
                empresaId,
                empresaNombre,
                nombreProyecto,
                fechaCotizacion,
                tipoCotizacion,
                subtotal,
                iva,
                totalNeto,
                creadoPor
            ]
        );
        proyectoId = result.insertId;

        for (const linea of lineas) {
            await conexion.query(
                `INSERT INTO innovacion_cotizacion_linea
                 (proyecto_id, orden, sign_id, nombre_senal, clasificacion, forma,
                  forma_personalizado_texto, distancia_visualizacion_m, largo_cm, ancho_cm,
                  tamano_texto, materiales_json, cantidad, costo_unitario, subtotal, notas)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                [
                    proyectoId,
                    linea.orden,
                    linea.signId,
                    linea.nombreSenal,
                    linea.clasificacion,
                    linea.forma,
                    linea.formaPersonalizadoTexto,
                    linea.distanciaVisualizacionM,
                    linea.largoCm,
                    linea.anchoCm,
                    linea.tamanoTexto,
                    JSON.stringify(linea.materiales),
                    linea.cantidad,
                    linea.costoUnitario,
                    linea.subtotal,
                    linea.notas
                ]
            );
        }
        await conexion.commit();
    } catch (error) {
        await conexion.rollback();
        throw error;
    } finally {
        conexion.release();
    }

    let driveFileId = null;
    let webViewLink = null;
    try {
        const sheetInfo = await rellenarSheetCotizacion(
            {
                folio,
                empresaNombre,
                nombreProyecto,
                fechaCotizacion,
                subtotal,
                iva,
                totalNeto
            },
            lineas
        );
        driveFileId = sheetInfo.driveFileId;
        webViewLink = sheetInfo.webViewLink;
        await pool.query(
            `UPDATE innovacion_cotizacion_proyecto
             SET drive_file_id = ?, web_view_link = ?
             WHERE id = ?`,
            [driveFileId, webViewLink, proyectoId]
        );
    } catch (error) {
        console.warn(
            `[INNOVACION-COTIZACION] Cotización ${folio} guardada sin Sheet: ${error.message}`
        );
    }

    return obtenerProyecto(pool, proyectoId);
}

async function eliminarHojaCotizacionSiExiste(proyecto) {
    if (!proyecto) {
        return;
    }
    const spreadsheetId = proyecto.driveFileId || PLANTILLA_SHEET_ID;
    const gidMatch = String(proyecto.webViewLink || '').match(/[?&#]gid=(\d+)/);
    if (!gidMatch) {
        return;
    }
    const sheetId = Number(gidMatch[1]);
    if (!Number.isFinite(sheetId)) {
        return;
    }
    try {
        const hojas = await driveService.obtenerMetadatosHojasGoogleSheet(spreadsheetId);
        const hoja = hojas.find((h) => Number(h.sheetId) === sheetId);
        if (hoja?.title) {
            await driveService.eliminarHojasGoogleSheet(spreadsheetId, [hoja.title]);
        }
    } catch (error) {
        console.warn(
            `[INNOVACION-COTIZACION] No se pudo eliminar hoja de cotización ${proyecto.folio}: ${error.message}`
        );
    }
}

async function desactivarProyecto(pool, id, usuario) {
    const proyectoId = Number(id);
    if (!Number.isInteger(proyectoId) || proyectoId <= 0) {
        throw new Error('ID de cotización no válido.');
    }
    const proyecto = await obtenerProyecto(pool, proyectoId);
    if (!proyecto) {
        return null;
    }
    if (!proyecto.activo) {
        return proyecto;
    }
    const desactivadoPor = sanitizarTexto(usuario, 128) || null;
    await pool.query(
        `UPDATE innovacion_cotizacion_proyecto
         SET activo = 0, desactivado_por = ?, desactivado_at = NOW()
         WHERE id = ?`,
        [desactivadoPor, proyectoId]
    );
    return obtenerProyecto(pool, proyectoId);
}

/** @deprecated Usar desactivarProyecto: no se borran registros, solo se desactivan. */
async function eliminarProyecto(pool, id, usuario) {
    return desactivarProyecto(pool, id, usuario);
}

async function actualizarProyecto(pool, id, payload, usuario) {
    const proyectoId = Number(id);
    if (!Number.isInteger(proyectoId) || proyectoId <= 0) {
        throw new Error('ID de cotización no válido.');
    }
    const existente = await obtenerProyecto(pool, proyectoId);
    if (!existente) {
        return null;
    }
    if (!existente.activo) {
        throw new Error('No se puede editar una cotización desactivada.');
    }

    const empresaNombre = sanitizarTexto(payload.empresa_nombre ?? payload.empresaNombre, 255);
    if (!empresaNombre) {
        throw new Error('El nombre de la empresa es obligatorio.');
    }
    const nombreProyecto = sanitizarTexto(payload.nombre_proyecto ?? payload.nombreProyecto, 255);
    if (!nombreProyecto) {
        throw new Error('El nombre del proyecto es obligatorio.');
    }
    const fechaCotizacion = String(payload.fecha_cotizacion ?? payload.fechaCotizacion ?? '').trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(fechaCotizacion)) {
        throw new Error('La fecha de cotización debe tener formato YYYY-MM-DD.');
    }

    const tipoCotizacion = normalizarTipoCotizacion(
        payload.tipo_cotizacion ?? payload.tipoCotizacion
    );

    let empresaId = payload.empresa_id ?? payload.empresaId ?? null;
    if (empresaId != null && empresaId !== '') {
        empresaId = Number(empresaId);
        if (!Number.isInteger(empresaId) || empresaId <= 0) {
            throw new Error('empresa_id no es válido.');
        }
    } else {
        empresaId = null;
    }

    const lineas = await construirLineasValidadas(pool, payload.lineas);
    const subtotal = redondear2(lineas.reduce((acc, l) => acc + l.subtotal, 0));
    const iva = redondear2(subtotal * IVA_TASA);
    const totalNeto = redondear2(subtotal + iva);
    const folio = existente.folio;

    const conexion = await pool.getConnection();
    try {
        await conexion.beginTransaction();
        await conexion.query(
            `UPDATE innovacion_cotizacion_proyecto
             SET empresa_id = ?, empresa_nombre = ?, nombre_proyecto = ?, fecha_cotizacion = ?,
                 tipo_cotizacion = ?, subtotal = ?, iva = ?, total_neto = ?
             WHERE id = ?`,
            [
                empresaId,
                empresaNombre,
                nombreProyecto,
                fechaCotizacion,
                tipoCotizacion,
                subtotal,
                iva,
                totalNeto,
                proyectoId
            ]
        );
        await conexion.query('DELETE FROM innovacion_cotizacion_linea WHERE proyecto_id = ?', [
            proyectoId
        ]);
        for (const linea of lineas) {
            await conexion.query(
                `INSERT INTO innovacion_cotizacion_linea
                 (proyecto_id, orden, sign_id, nombre_senal, clasificacion, forma,
                  forma_personalizado_texto, distancia_visualizacion_m, largo_cm, ancho_cm,
                  tamano_texto, materiales_json, cantidad, costo_unitario, subtotal, notas)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                [
                    proyectoId,
                    linea.orden,
                    linea.signId,
                    linea.nombreSenal,
                    linea.clasificacion,
                    linea.forma,
                    linea.formaPersonalizadoTexto,
                    linea.distanciaVisualizacionM,
                    linea.largoCm,
                    linea.anchoCm,
                    linea.tamanoTexto,
                    JSON.stringify(linea.materiales),
                    linea.cantidad,
                    linea.costoUnitario,
                    linea.subtotal,
                    linea.notas
                ]
            );
        }
        await conexion.commit();
    } catch (error) {
        await conexion.rollback();
        throw error;
    } finally {
        conexion.release();
    }

    try {
        await eliminarHojaCotizacionSiExiste(existente);
        const sheetInfo = await rellenarSheetCotizacion(
            {
                folio,
                empresaNombre,
                nombreProyecto,
                fechaCotizacion,
                subtotal,
                iva,
                totalNeto
            },
            lineas
        );
        await pool.query(
            `UPDATE innovacion_cotizacion_proyecto
             SET drive_file_id = ?, web_view_link = ?
             WHERE id = ?`,
            [sheetInfo.driveFileId, sheetInfo.webViewLink, proyectoId]
        );
    } catch (error) {
        console.warn(
            `[INNOVACION-COTIZACION] Cotización ${folio} actualizada sin Sheet: ${error.message}`
        );
    }

    return obtenerProyecto(pool, proyectoId);
}

module.exports = {
    PLANTILLA_SHEET_ID,
    IVA_TASA,
    FORMAS_VALIDAS,
    TIPOS_COTIZACION_VALIDOS,
    asegurarTablas,
    siguienteFolio,
    listarProyectos,
    obtenerProyecto,
    crearProyecto,
    actualizarProyecto,
    desactivarProyecto,
    eliminarProyecto,
    exportarExcelHistorial
};
