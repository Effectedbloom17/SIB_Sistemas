/**
 * Recursos Humanos — Registro de residentes.
 * Persistencia en BD biznaga (tabla RRHH_residentes) + hoja/pestaña por residente
 * en el Google Sheet plantilla.
 */
const driveService = require('./driveService');

const SPREADSHEET_ID = '1DIxeYf2pwQjaXJDvkaOGe_zHaVEGPE6f90xDxq0B75o';
const PLANTILLA_TAB = 'Plantilla Residentes';

const CAMPOS = [
    'anio',
    'nombre',
    'edad',
    'estancia',
    'escuela_procedencia',
    'carrera',
    'fecha_ingreso',
    'fecha_terminacion',
    'nombre_proyecto',
    'supervision_a_cargo',
    'telefono',
    'correo_personal',
    'correo_institucional',
    'matricula',
    'asesor_academico',
    'correo_asesor',
    'tutor_nombre',
    'tutor_telefono',
    'direccion',
    'nss'
];

const EJEMPLO_KARLA = {
    anio: 2026,
    nombre: 'KARLA DANIELA LOPEZ GOMEZ',
    edad: 20,
    estancia: '4 MESES',
    escuela_procedencia: 'Universidad Politécnica de Francisco I. Madero',
    carrera: 'INGENIERIA EN DISEÑO INDUSTRIAL',
    fecha_ingreso: '11-may-26',
    fecha_terminacion: '21 DE AGOSTO 2026',
    nombre_proyecto: 'Diseño de señales de seguriad',
    supervision_a_cargo: 'Ing. Leonel Pérez',
    telefono: '7721080392',
    correo_personal: 'lopezdelcastillok@gmail.com',
    correo_institucional: 'na',
    matricula: '2401160039',
    asesor_academico: 'Ing. Eduardo Ortuño mercado',
    correo_asesor: 'eomercado@upfim.edu.mx',
    tutor_nombre: 'Norma Angelica Gomez valdez',
    tutor_telefono: '7736802483',
    direccion: 'Col. Calvario Mixquiahuala',
    nss: '30240665692'
};

function txt(valor, maxLen = 500) {
    const s = String(valor == null ? '' : valor).trim().replace(/\s+/g, ' ');
    if (!s) return '';
    return s.slice(0, maxLen);
}

function normalizarPayload(body = {}) {
    const out = {};
    for (const campo of CAMPOS) {
        if (campo === 'anio' || campo === 'edad') {
            const n = Number(body[campo]);
            out[campo] = Number.isFinite(n) ? Math.trunc(n) : null;
        } else {
            out[campo] = txt(body[campo], campo === 'direccion' || campo === 'nombre_proyecto' ? 500 : 255);
        }
    }
    if (!out.nombre) {
        throw new Error('El nombre del residente es obligatorio');
    }
    if (out.anio == null) {
        out.anio = new Date().getFullYear();
    }
    return out;
}

function escaparTituloTab(title) {
    return String(title).replace(/'/g, "''");
}

function sanitizarTituloTab(nombre, idFallback) {
    let t = String(nombre || '')
        .replace(/[\[\]\*\?\/\\:]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
    if (!t) t = `Residente ${idFallback || ''}`.trim();
    if (t.length > 90) t = t.slice(0, 90).trim();
    return t;
}

function urlsHoja(gid) {
    const base = `https://docs.google.com/spreadsheets/d/${SPREADSHEET_ID}`;
    const gidStr = gid != null && gid !== '' ? String(gid) : '';
    return {
        drive_file_id: SPREADSHEET_ID,
        editor_url: gidStr
            ? `${base}/edit?usp=sharing#gid=${gidStr}`
            : `${base}/edit?usp=sharing`,
        embed_url: driveService.construirUrlEditorGoogleSheet(SPREADSHEET_ID, {
            modo: 'edit',
            gid: gidStr || undefined
        }),
        preview_url: gidStr ? `${base}/preview#gid=${gidStr}` : `${base}/preview`,
        sheet_gid: gidStr || null
    };
}

function mapResidente(row) {
    if (!row) return null;
    const urls = urlsHoja(row.drive_sheet_gid);
    return {
        id: row.id,
        ...Object.fromEntries(CAMPOS.map((c) => [c, row[c] ?? (c === 'anio' || c === 'edad' ? null : '')])),
        foto_url: row.foto_url || null,
        drive_sheet_title: row.drive_sheet_title || null,
        drive_sheet_gid: row.drive_sheet_gid != null ? String(row.drive_sheet_gid) : null,
        activo: row.activo == null ? 1 : Number(row.activo),
        creado_por: row.creado_por || null,
        actualizado_por: row.actualizado_por || null,
        created_at: row.created_at || null,
        updated_at: row.updated_at || null,
        ...urls
    };
}

function normalizarFotoUrl(valor) {
    const s = String(valor == null ? '' : valor).trim();
    if (!s) return null;
    // data URL (foto local) o URL http(s)
    if (s.startsWith('data:image/')) {
        if (s.length > 8_000_000) {
            throw new Error('La foto es demasiado grande (máx. ~5 MB)');
        }
        return s;
    }
    if (/^https?:\/\//i.test(s)) {
        return s.slice(0, 1000);
    }
    return null;
}

async function asegurarTabla(pool) {
    await pool.query(`
        CREATE TABLE IF NOT EXISTS RRHH_residentes (
            id INT AUTO_INCREMENT PRIMARY KEY,
            anio SMALLINT NULL,
            nombre VARCHAR(255) NOT NULL,
            edad SMALLINT NULL,
            estancia VARCHAR(100) NULL,
            escuela_procedencia VARCHAR(255) NULL,
            carrera VARCHAR(255) NULL,
            fecha_ingreso VARCHAR(100) NULL,
            fecha_terminacion VARCHAR(100) NULL,
            nombre_proyecto VARCHAR(500) NULL,
            supervision_a_cargo VARCHAR(255) NULL,
            telefono VARCHAR(50) NULL,
            correo_personal VARCHAR(255) NULL,
            correo_institucional VARCHAR(255) NULL,
            matricula VARCHAR(100) NULL,
            asesor_academico VARCHAR(255) NULL,
            correo_asesor VARCHAR(255) NULL,
            tutor_nombre VARCHAR(255) NULL,
            tutor_telefono VARCHAR(50) NULL,
            direccion VARCHAR(500) NULL,
            nss VARCHAR(50) NULL,
            foto_url MEDIUMTEXT NULL,
            drive_sheet_title VARCHAR(120) NULL,
            drive_sheet_gid VARCHAR(32) NULL,
            activo TINYINT(1) NOT NULL DEFAULT 1,
            creado_por VARCHAR(120) NULL,
            actualizado_por VARCHAR(120) NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            INDEX idx_rrhh_residentes_nombre (nombre),
            INDEX idx_rrhh_residentes_anio (anio),
            INDEX idx_rrhh_residentes_activo (activo)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    // Migración suave si la tabla ya existía sin foto
    try {
        const [cols] = await pool.query(
            `SELECT COLUMN_NAME AS c
             FROM INFORMATION_SCHEMA.COLUMNS
             WHERE TABLE_SCHEMA = DATABASE()
               AND TABLE_NAME = 'RRHH_residentes'
               AND COLUMN_NAME = 'foto_url'`
        );
        if (!cols?.length) {
            await pool.query('ALTER TABLE RRHH_residentes ADD COLUMN foto_url MEDIUMTEXT NULL AFTER nss');
        }
    } catch (e) {
        console.warn('[RRHH] No se pudo asegurar columna foto_url:', e.message);
    }
}

function celdasDesdeResidente(datos, sheetTitle) {
    const tab = escaparTituloTab(sheetTitle);
    const v = (campo) => {
        const val = datos[campo];
        if (val == null || val === '') return '';
        return String(val);
    };
    // Fechas: etiqueta arriba (fila 9) y valor abajo (fila 10), lado a lado.
    return [
        { range: `'${tab}'!G2`, values: [[v('anio')]] },
        { range: `'${tab}'!C5`, values: [[v('nombre')]] },
        { range: `'${tab}'!C6`, values: [[v('edad')]] },
        { range: `'${tab}'!F6`, values: [[v('estancia')]] },
        { range: `'${tab}'!C7`, values: [[v('escuela_procedencia')]] },
        { range: `'${tab}'!C8`, values: [[v('carrera')]] },
        { range: `'${tab}'!A10`, values: [[v('fecha_ingreso')]] },
        { range: `'${tab}'!D10`, values: [[v('fecha_terminacion')]] },
        { range: `'${tab}'!C12`, values: [[v('nombre_proyecto')]] },
        { range: `'${tab}'!C13`, values: [[v('supervision_a_cargo')]] },
        { range: `'${tab}'!C15`, values: [[v('telefono')]] },
        { range: `'${tab}'!C16`, values: [[v('correo_personal')]] },
        { range: `'${tab}'!C17`, values: [[v('correo_institucional')]] },
        { range: `'${tab}'!C18`, values: [[v('matricula')]] },
        { range: `'${tab}'!C19`, values: [[v('asesor_academico')]] },
        { range: `'${tab}'!C20`, values: [[v('correo_asesor')]] },
        { range: `'${tab}'!C22`, values: [[v('tutor_nombre')]] },
        { range: `'${tab}'!C23`, values: [[v('tutor_telefono')]] },
        { range: `'${tab}'!C24`, values: [[v('nss')]] }
    ];
}

/**
 * Reestructura filas 9–10: etiquetas de fecha arriba y valores abajo (no a la derecha).
 * Idempotente: si ya está en el layout nuevo, no hace cambios estructurales.
 */
async function asegurarLayoutFechasHoja(sheetTitle) {
    const { google } = require('googleapis');
    await driveService.validarAutenticacionDrive();
    const auth = driveService.getAuthClient();
    if (!auth) {
        throw new Error('Drive no autenticado');
    }
    const sheetsApi = google.sheets({ version: 'v4', auth });
    const tab = String(sheetTitle || '').trim();
    if (!tab) return false;

    const meta = await sheetsApi.spreadsheets.get({
        spreadsheetId: SPREADSHEET_ID,
        ranges: [`'${escaparTituloTab(tab)}'!A9:F10`],
        fields: 'sheets(properties(sheetId,title),merges)'
    });
    const sheet = (meta.data.sheets || []).find((s) => String(s.properties?.title || '') === tab)
        || (meta.data.sheets || [])[0];
    const sheetId = sheet?.properties?.sheetId;
    if (sheetId == null) return false;

    const vals = await sheetsApi.spreadsheets.values.get({
        spreadsheetId: SPREADSHEET_ID,
        range: `'${escaparTituloTab(tab)}'!A9:F10`,
        majorDimension: 'ROWS'
    });
    const rows = vals.data.values || [];
    const a9 = String(rows[0]?.[0] || '').trim().toUpperCase();
    const d9 = String(rows[0]?.[3] || '').trim().toUpperCase();
    const a10 = String(rows[1]?.[0] || '').trim().toUpperCase();
    const c9 = String(rows[0]?.[2] || '').trim();
    const c10 = String(rows[1]?.[2] || '').trim();
    const a10Val = String(rows[1]?.[0] || '').trim();
    const d10Val = String(rows[1]?.[3] || '').trim();

    const yaNuevo = a9.includes('FECHA DE INGRESO') && d9.includes('FECHA DE TERMIN');
    if (yaNuevo) {
        return false;
    }

    // Layout viejo: etiqueta en A9/A10 y valor a la derecha (C9/C10)
    const ingresoLegacy = c9;
    const terminacionLegacy = a10.includes('FECHA DE TERMIN') ? c10 : (c10 || a10Val);
    const ingresoFinal = ingresoLegacy || (a10.includes('FECHA') ? '' : a10Val);
    const terminacionFinal = terminacionLegacy || d10Val;

    const merges = Array.isArray(sheet.merges) ? sheet.merges : [];
    const unmergeRequests = [];
    for (const m of merges) {
        const r0 = Number(m.startRowIndex);
        const r1 = Number(m.endRowIndex);
        // Solo filas 9–10 (índices 8–10)
        if (r0 >= 8 && r1 <= 10 && Number(m.sheetId) === Number(sheetId)) {
            unmergeRequests.push({ unmergeCells: { range: { ...m, sheetId } } });
        }
    }

    const requests = [
        ...unmergeRequests,
        {
            mergeCells: {
                range: {
                    sheetId,
                    startRowIndex: 8,
                    endRowIndex: 9,
                    startColumnIndex: 0,
                    endColumnIndex: 3
                },
                mergeType: 'MERGE_ALL'
            }
        },
        {
            mergeCells: {
                range: {
                    sheetId,
                    startRowIndex: 8,
                    endRowIndex: 9,
                    startColumnIndex: 3,
                    endColumnIndex: 6
                },
                mergeType: 'MERGE_ALL'
            }
        },
        {
            mergeCells: {
                range: {
                    sheetId,
                    startRowIndex: 9,
                    endRowIndex: 10,
                    startColumnIndex: 0,
                    endColumnIndex: 3
                },
                mergeType: 'MERGE_ALL'
            }
        },
        {
            mergeCells: {
                range: {
                    sheetId,
                    startRowIndex: 9,
                    endRowIndex: 10,
                    startColumnIndex: 3,
                    endColumnIndex: 6
                },
                mergeType: 'MERGE_ALL'
            }
        }
    ];

    if (requests.length) {
        await sheetsApi.spreadsheets.batchUpdate({
            spreadsheetId: SPREADSHEET_ID,
            requestBody: { requests }
        });
    }

    await sheetsApi.spreadsheets.values.batchUpdate({
        spreadsheetId: SPREADSHEET_ID,
        requestBody: {
            valueInputOption: 'USER_ENTERED',
            data: [
                {
                    range: `'${escaparTituloTab(tab)}'!A9:F10`,
                    values: [
                        ['FECHA DE INGRESO', '', '', 'FECHA DE TERMINACIÓN', '', ''],
                        [ingresoFinal || '', '', '', terminacionFinal || '', '', '']
                    ]
                }
            ]
        }
    });

    return true;
}

async function asegurarHojaResidente(pool, residente) {
    const desiredTitle = sanitizarTituloTab(residente.nombre, residente.id);
    const hojas = await driveService.obtenerMetadatosHojasGoogleSheet(SPREADSHEET_ID);

    if (residente.drive_sheet_gid != null && residente.drive_sheet_gid !== '') {
        const byGid = hojas.find((h) => String(h.sheetId) === String(residente.drive_sheet_gid));
        if (byGid) {
            let title = byGid.title;
            if (title !== desiredTitle && title !== PLANTILLA_TAB) {
                try {
                    const renamed = await driveService.renombrarHojaGoogleSheet(
                        SPREADSHEET_ID,
                        title,
                        desiredTitle
                    );
                    title = renamed.title || desiredTitle;
                } catch (e) {
                    console.warn('[RRHH] No se pudo renombrar hoja:', e.message);
                }
            }
            if (title !== residente.drive_sheet_title) {
                await pool.query(
                    'UPDATE RRHH_residentes SET drive_sheet_title = ?, drive_sheet_gid = ? WHERE id = ?',
                    [title, String(byGid.sheetId), residente.id]
                );
            }
            return { title, gid: byGid.sheetId };
        }
    }

    const existente = hojas.find(
        (h) => String(h.title || '').trim().toLowerCase() === desiredTitle.toLowerCase()
    );
    if (existente) {
        await pool.query(
            'UPDATE RRHH_residentes SET drive_sheet_title = ?, drive_sheet_gid = ? WHERE id = ?',
            [existente.title, String(existente.sheetId), residente.id]
        );
        return { title: existente.title, gid: existente.sheetId };
    }

    const dup = await driveService.duplicarHojaGoogleSheet(
        SPREADSHEET_ID,
        PLANTILLA_TAB,
        desiredTitle
    );
    await pool.query(
        'UPDATE RRHH_residentes SET drive_sheet_title = ?, drive_sheet_gid = ? WHERE id = ?',
        [dup.title, String(dup.sheetId), residente.id]
    );
    return { title: dup.title, gid: dup.sheetId };
}

async function sincronizarResidenteADrive(pool, residenteId) {
    const residente = await obtener(pool, residenteId);
    if (!residente) {
        throw new Error('Residente no encontrado');
    }
    const { title, gid } = await asegurarHojaResidente(pool, residente);
    try {
        await asegurarLayoutFechasHoja(PLANTILLA_TAB);
    } catch (e) {
        console.warn('[RRHH] No se pudo actualizar layout de fechas en plantilla:', e.message);
    }
    try {
        await asegurarLayoutFechasHoja(title);
    } catch (e) {
        console.warn('[RRHH] No se pudo actualizar layout de fechas:', e.message);
    }
    await driveService.actualizarCeldasGoogleSheet(
        SPREADSHEET_ID,
        celdasDesdeResidente(residente, title)
    );
    const actualizado = await obtener(pool, residenteId);
    return {
        residente: actualizado,
        sheet: {
            title,
            gid: String(gid),
            ...urlsHoja(gid)
        }
    };
}

async function listar(pool, { anio, q } = {}) {
    await asegurarTabla(pool);
    const where = ['activo = 1'];
    const params = [];
    if (anio != null && anio !== '') {
        where.push('anio = ?');
        params.push(Number(anio));
    }
    const busqueda = txt(q, 120);
    if (busqueda) {
        where.push('(nombre LIKE ? OR matricula LIKE ? OR escuela_procedencia LIKE ? OR nombre_proyecto LIKE ?)');
        const like = `%${busqueda}%`;
        params.push(like, like, like, like);
    }
    const [rows] = await pool.query(
        `SELECT * FROM RRHH_residentes
         WHERE ${where.join(' AND ')}
         ORDER BY anio DESC, nombre ASC, id DESC`,
        params
    );
    return (rows || []).map(mapResidente);
}

async function obtener(pool, id) {
    await asegurarTabla(pool);
    const [rows] = await pool.query(
        'SELECT * FROM RRHH_residentes WHERE id = ? AND activo = 1 LIMIT 1',
        [Number(id)]
    );
    return mapResidente(rows?.[0] || null);
}

async function crear(pool, body, usuario = null) {
    await asegurarTabla(pool);
    const datos = normalizarPayload(body);
    const fotoUrl = Object.prototype.hasOwnProperty.call(body || {}, 'foto_url')
        ? normalizarFotoUrl(body.foto_url)
        : null;
    const [result] = await pool.query(
        `INSERT INTO RRHH_residentes (
            anio, nombre, edad, estancia, escuela_procedencia, carrera,
            fecha_ingreso, fecha_terminacion, nombre_proyecto, supervision_a_cargo,
            telefono, correo_personal, correo_institucional, matricula,
            asesor_academico, correo_asesor, tutor_nombre, tutor_telefono,
            direccion, nss, foto_url, creado_por, actualizado_por
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
            datos.anio,
            datos.nombre,
            datos.edad,
            datos.estancia || null,
            datos.escuela_procedencia || null,
            datos.carrera || null,
            datos.fecha_ingreso || null,
            datos.fecha_terminacion || null,
            datos.nombre_proyecto || null,
            datos.supervision_a_cargo || null,
            datos.telefono || null,
            datos.correo_personal || null,
            datos.correo_institucional || null,
            datos.matricula || null,
            datos.asesor_academico || null,
            datos.correo_asesor || null,
            datos.tutor_nombre || null,
            datos.tutor_telefono || null,
            datos.direccion || null,
            datos.nss || null,
            fotoUrl,
            usuario,
            usuario
        ]
    );
    const id = result.insertId;
    try {
        await sincronizarResidenteADrive(pool, id);
    } catch (e) {
        console.warn('[RRHH] Residente creado pero falló sync Drive:', e.message);
    }
    return obtener(pool, id);
}

async function actualizar(pool, id, body, usuario = null) {
    await asegurarTabla(pool);
    const actual = await obtener(pool, id);
    if (!actual) {
        throw new Error('Residente no encontrado');
    }
    const datos = normalizarPayload({ ...actual, ...body });
    const fotoUrl = Object.prototype.hasOwnProperty.call(body || {}, 'foto_url')
        ? normalizarFotoUrl(body.foto_url)
        : (actual.foto_url || null);
    await pool.query(
        `UPDATE RRHH_residentes SET
            anio = ?, nombre = ?, edad = ?, estancia = ?, escuela_procedencia = ?,
            carrera = ?, fecha_ingreso = ?, fecha_terminacion = ?, nombre_proyecto = ?,
            supervision_a_cargo = ?, telefono = ?, correo_personal = ?,
            correo_institucional = ?, matricula = ?, asesor_academico = ?,
            correo_asesor = ?, tutor_nombre = ?, tutor_telefono = ?, direccion = ?,
            nss = ?, foto_url = ?, actualizado_por = ?
         WHERE id = ? AND activo = 1`,
        [
            datos.anio,
            datos.nombre,
            datos.edad,
            datos.estancia || null,
            datos.escuela_procedencia || null,
            datos.carrera || null,
            datos.fecha_ingreso || null,
            datos.fecha_terminacion || null,
            datos.nombre_proyecto || null,
            datos.supervision_a_cargo || null,
            datos.telefono || null,
            datos.correo_personal || null,
            datos.correo_institucional || null,
            datos.matricula || null,
            datos.asesor_academico || null,
            datos.correo_asesor || null,
            datos.tutor_nombre || null,
            datos.tutor_telefono || null,
            datos.direccion || null,
            datos.nss || null,
            fotoUrl,
            usuario,
            Number(id)
        ]
    );
    try {
        await sincronizarResidenteADrive(pool, id);
    } catch (e) {
        console.warn('[RRHH] Residente actualizado pero falló sync Drive:', e.message);
    }
    return obtener(pool, id);
}

async function eliminar(pool, id, usuario = null) {
    await asegurarTabla(pool);
    const [result] = await pool.query(
        `UPDATE RRHH_residentes
         SET activo = 0, actualizado_por = ?
         WHERE id = ? AND activo = 1`,
        [usuario, Number(id)]
    );
    return Number(result.affectedRows || 0) > 0;
}

async function seedEjemploSiVacio(pool) {
    await asegurarTabla(pool);
    const [rows] = await pool.query(
        `SELECT id FROM RRHH_residentes
         WHERE activo = 1 AND UPPER(nombre) = ?
         LIMIT 1`,
        [EJEMPLO_KARLA.nombre.toUpperCase()]
    );
    if (rows?.length) {
        const id = rows[0].id;
        try {
            await sincronizarResidenteADrive(pool, id);
        } catch (e) {
            const msg = String(e.message || '');
            if (/DRIVE-AUTH|invalid_client|OAuth client was not found|bloqueado temporalmente/i.test(msg)) {
                // Desarrollo sin OAuth real: no ensuciar consola
            } else {
                console.warn('[RRHH] Sync ejemplo existente falló:', msg);
            }
        }
        return obtener(pool, id);
    }
    return crear(pool, EJEMPLO_KARLA, 'sistema');
}

module.exports = {
    SPREADSHEET_ID,
    PLANTILLA_TAB,
    CAMPOS,
    EJEMPLO_KARLA,
    asegurarTabla,
    listar,
    obtener,
    crear,
    actualizar,
    eliminar,
    sincronizarResidenteADrive,
    seedEjemploSiVacio
};
