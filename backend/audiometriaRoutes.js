/**
 * Audiometrías ocupacionales (BD medicos).
 * El formulario completo vive en datos_json para poder ampliar la plantilla
 * sin migrar una columna por cada campo.
 */

const { asegurarCarpetaAudiometrias, guardarExcelAudiometria } = require('./audiometriaExcel');

const TABLA_LISTA = new Map();

function poolMedicosDe(deps) {
    return typeof deps.getPoolMedicos === 'function' ? deps.getPoolMedicos() : null;
}

function poolPrincipalDe(deps) {
    return typeof deps.getPool === 'function' ? deps.getPool() : null;
}

async function asegurarTabla(pool, dbKey) {
    if (!pool) {
        throw new Error('Base de médicos no disponible');
    }
    if (TABLA_LISTA.get(dbKey)) {
        return TABLA_LISTA.get(dbKey);
    }
    const promesa = pool.query(`
        CREATE TABLE IF NOT EXISTS audiometria (
            id INT AUTO_INCREMENT PRIMARY KEY,
            empresa_id INT NULL,
            instructor_id INT NULL,
            folio VARCHAR(40) NULL,
            tipo_audiometria VARCHAR(80) NULL,
            nombre VARCHAR(200) NULL,
            fecha_elaboracion DATE NULL,
            ocupacion VARCHAR(150) NULL,
            edad VARCHAR(20) NULL,
            personal_elaboro VARCHAR(200) NULL,
            cedula_profesional VARCHAR(80) NULL,
            datos_json LONGTEXT NULL,
            activo TINYINT(1) NOT NULL DEFAULT 1,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            INDEX idx_audiometria_empresa (empresa_id),
            INDEX idx_audiometria_nombre (nombre)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `).then(async () => {
        const columnas = [
            'ALTER TABLE audiometria ADD COLUMN drive_file_id VARCHAR(128) NULL',
            'ALTER TABLE audiometria ADD COLUMN drive_url VARCHAR(500) NULL'
        ];
        for (const sql of columnas) {
            try {
                await pool.query(sql);
            } catch (error) {
                if (error.code !== 'ER_DUP_FIELDNAME' && !String(error.message || '').includes('Duplicate column')) {
                    throw error;
                }
            }
        }
        return true;
    });
    TABLA_LISTA.set(dbKey, promesa);
    try {
        await promesa;
    } catch (error) {
        TABLA_LISTA.delete(dbKey);
        throw error;
    }
}

function fechaSoloDia(valor) {
    if (!valor) return null;
    if (valor instanceof Date && !Number.isNaN(valor.getTime())) {
        const mes = String(valor.getMonth() + 1).padStart(2, '0');
        const dia = String(valor.getDate()).padStart(2, '0');
        return `${valor.getFullYear()}-${mes}-${dia}`;
    }
    const texto = String(valor).trim();
    const match = texto.match(/^(\d{4}-\d{2}-\d{2})/);
    return match ? match[1] : null;
}

function recortar(valor, max) {
    const texto = String(valor ?? '').trim();
    if (!texto) return null;
    return texto.slice(0, max);
}

function leerDatos(row) {
    let datos = {};
    try {
        datos = row?.datos_json ? JSON.parse(row.datos_json) : {};
    } catch (error) {
        datos = {};
    }
    if (!datos || typeof datos !== 'object' || Array.isArray(datos)) {
        datos = {};
    }
    return datos;
}

function filaPublica(row, incluirDatos) {
    const publica = {
        id: row.id,
        empresa_id: row.empresa_id,
        instructor_id: row.instructor_id,
        folio: row.folio,
        tipo_audiometria: row.tipo_audiometria,
        nombre: row.nombre,
        fecha_elaboracion: fechaSoloDia(row.fecha_elaboracion),
        ocupacion: row.ocupacion,
        edad: row.edad,
        personal_elaboro: row.personal_elaboro,
        cedula_profesional: row.cedula_profesional,
        drive_file_id: row.drive_file_id || null,
        drive_url: row.drive_url || null,
        created_at: row.created_at,
        updated_at: row.updated_at
    };
    if (incluirDatos) {
        publica.datos = leerDatos(row);
    }
    return publica;
}

function camposDesdeBody(body) {
    const datos = body?.datos && typeof body.datos === 'object' && !Array.isArray(body.datos)
        ? body.datos
        : {};
    const json = JSON.stringify(datos);
    if (json.length > 500000) {
        const error = new Error('La audiometría excede el tamaño permitido');
        error.status = 400;
        throw error;
    }
    return {
        empresa_id: Number(body.empresa_id) || null,
        instructor_id: Number(body.instructor_id) || null,
        tipo_audiometria: recortar(body.tipo_audiometria ?? datos.tipoAudiometria, 80),
        nombre: recortar(body.nombre ?? datos.nombre, 200),
        fecha_elaboracion: fechaSoloDia(body.fecha_elaboracion ?? datos.fechaElaboracion),
        ocupacion: recortar(body.ocupacion ?? datos.ocupacion, 150),
        edad: recortar(body.edad ?? datos.edad, 20),
        personal_elaboro: recortar(body.personal_elaboro ?? datos.personalElaboro, 200),
        cedula_profesional: recortar(body.cedula_profesional ?? datos.cedulaProfesional, 80),
        datos_json: json
    };
}

async function nombreEmpresa(deps, empresaId, nombreFallback) {
    const fallback = String(nombreFallback || '').trim();
    const pool = poolPrincipalDe(deps);
    if (!pool || typeof pool.query !== 'function' || pool.__sinConexion) {
        return fallback;
    }
    try {
        const [rows] = await pool.query(
            'SELECT nombre_empresa FROM empresa WHERE empresa_id = ? AND activo = TRUE LIMIT 1',
            [empresaId]
        );
        return rows[0]?.nombre_empresa || fallback;
    } catch (error) {
        if (fallback) {
            return fallback;
        }
        throw error;
    }
}

const FRECUENCIAS_OD = [125, 250, 500, 750, 1000, 1500, 2000, 3000, 4000, 6000, 8000];
const FRECUENCIAS_SUMA_OI = [1000, 1500, 2000, 3000, 4000];
const FRECUENCIAS_MEDIA = [1000, 1500, 2000, 4000];

function sinAcento(valor) {
    return String(valor ?? '').trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

function esSi(valor) {
    return sinAcento(valor) === 'si' || valor === true;
}

function valorUmbral(raw) {
    if (raw === null || raw === undefined || raw === '') return null;
    const numero = Number(raw);
    if (!Number.isFinite(numero) || numero < -10 || numero > 120) return null;
    return numero;
}

function umbralDe(umbrales, frecuencia, campo) {
    const item = (umbrales || []).find((umbral) => Number(umbral?.frecuencia) === frecuencia);
    return item ? valorUmbral(item[campo]) : null;
}

function operarUmbrales(umbrales, frecuencias, campo, calcular) {
    const valores = frecuencias.map((frecuencia) => umbralDe(umbrales, frecuencia, campo));
    if (valores.every((valor) => valor == null)) return null;
    return calcular(valores.map((valor) => valor ?? 0));
}

function mediaLado(umbrales, lado) {
    const campo = lado === 'Od' ? 'vaOd' : 'vaOi';
    return operarUmbrales(umbrales, FRECUENCIAS_MEDIA, campo, (valores) => {
        return valores.reduce((total, valor) => total + valor, 0) / 11;
    });
}

function sumaDb(umbrales, lado) {
    const campo = lado === 'Od' ? 'vaOd' : 'vaOi';
    const frecuencias = lado === 'Od' ? FRECUENCIAS_OD : FRECUENCIAS_SUMA_OI;
    return operarUmbrales(umbrales, frecuencias, campo, (valores) => valores.reduce((total, valor) => total + valor, 0));
}

function porcentajeOido(umbrales, lado) {
    const suma = sumaDb(umbrales, lado);
    if (suma == null) return null;
    if (suma <= 100) return 0;
    return Math.min(100, Math.max(0, Math.round((0.375 * suma) - 37.5)));
}

function porcentajeBinaural(umbrales) {
    const derecho = porcentajeOido(umbrales, 'Od');
    const izquierdo = porcentajeOido(umbrales, 'Oi');
    if (derecho == null || izquierdo == null) return null;
    if (izquierdo > derecho) return ((5 * derecho) + izquierdo) / 6;
    return ((5 * izquierdo) + derecho) / 6;
}

function grupoResultado(db) {
    if (db == null) return null;
    if (db <= 20) return 'normal';
    if (db <= 40) return 'leve';
    if (db <= 71) return 'moderada';
    if (db <= 91) return 'severa';
    return 'profunda';
}

function tieneTinnitus(valor) {
    const texto = sinAcento(valor);
    if (!texto) return false;
    return !['no', 'ninguno', 'ninguna', 'sin', 'n/a', 'na', '-'].includes(texto);
}

function clasificarCatalogo(valor, opciones) {
    const texto = sinAcento(valor);
    if (!texto) return '';
    return opciones.find((opcion) => sinAcento(opcion) === texto) || 'Otro';
}

function calcularEstadisticasAudiometria(rows) {
    const resultado = { normal: 0, leve: 0, moderada: 0, severa: 0, profunda: 0 };
    const oidos = {
        od: { normal: 0, alterado: 0 },
        oi: { normal: 0, alterado: 0 }
    };
    const tipos = { Inicial: 0, Periódica: 0, Confirmación: 0, Egreso: 0 };
    const protector = { Sí: 0, No: 0, Ocasional: 0 };
    const ruido = { Continuo: 0, Intermitente: 0, 'De impacto': 0, Mixto: 0 };
    const sintomas = {
        'Disminución de audición': 0,
        Tinnitus: 0,
        Otalgia: 0,
        Vértigo: 0,
        Mareos: 0,
        Otorrea: 0
    };
    let clasificados = 0;
    let conProtectorRespondido = 0;
    let conProtectorSi = 0;
    let conSintomas = 0;
    let sumaBinaural = 0;
    let conBinaural = 0;

    for (const row of rows) {
        const datos = leerDatos(row);
        const umbrales = Array.isArray(datos.umbrales) ? datos.umbrales : [];
        const derecho = mediaLado(umbrales, 'Od');
        const izquierdo = mediaLado(umbrales, 'Oi');
        if (derecho != null) {
            if (derecho > 20) oidos.od.alterado += 1;
            else oidos.od.normal += 1;
        }
        if (izquierdo != null) {
            if (izquierdo > 20) oidos.oi.alterado += 1;
            else oidos.oi.normal += 1;
        }
        if (derecho != null && izquierdo != null) {
            const grupo = grupoResultado((derecho + izquierdo) / 2);
            if (grupo) {
                resultado[grupo] += 1;
                clasificados += 1;
            }
        }
        const binaural = porcentajeBinaural(umbrales);
        if (binaural != null) {
            sumaBinaural += binaural;
            conBinaural += 1;
        }

        const tipo = clasificarCatalogo(
            row.tipo_audiometria || datos.tipoAudiometria,
            ['Inicial', 'Periódica', 'Confirmación', 'Egreso']
        );
        if (tipo && Object.prototype.hasOwnProperty.call(tipos, tipo)) tipos[tipo] += 1;

        const uso = clasificarCatalogo(datos.usoProtector, ['Sí', 'No', 'Ocasional']);
        if (uso && Object.prototype.hasOwnProperty.call(protector, uso)) {
            protector[uso] += 1;
            conProtectorRespondido += 1;
            if (sinAcento(uso) === 'si') conProtectorSi += 1;
        }

        const tipoRuido = clasificarCatalogo(datos.tipoRuido, ['Continuo', 'Intermitente', 'De impacto', 'Mixto']);
        if (tipoRuido && Object.prototype.hasOwnProperty.call(ruido, tipoRuido)) ruido[tipoRuido] += 1;

        const marcas = {
            'Disminución de audición': esSi(datos.disminucionAudicion),
            Tinnitus: tieneTinnitus(datos.tinnitus),
            Otalgia: esSi(datos.otalgia),
            Vértigo: esSi(datos.vertigo),
            Mareos: esSi(datos.mareos),
            Otorrea: esSi(datos.otorrea)
        };
        let alguno = false;
        Object.entries(marcas).forEach(([nombre, activo]) => {
            if (activo) {
                sintomas[nombre] += 1;
                alguno = true;
            }
        });
        if (alguno) conSintomas += 1;
    }

    const total = rows.length;
    const porcentaje = (parte, base) => (base > 0 ? Math.round((parte / base) * 100) : 0);
    return {
        total,
        pctNormal: porcentaje(resultado.normal, clasificados),
        pctProtector: porcentaje(conProtectorSi, conProtectorRespondido),
        pctSintomas: porcentaje(conSintomas, total),
        perdidaBinaural: conBinaural > 0 ? Math.round((sumaBinaural / conBinaural) * 10) / 10 : 0,
        resultado,
        oidos,
        tipos,
        protector,
        ruido,
        sintomas
    };
}

async function sincronizarExcel(poolMedicos, id, empresaNombre) {
    const [rows] = await poolMedicos.query('SELECT * FROM audiometria WHERE id = ? AND activo = 1', [id]);
    if (!rows.length) return null;
    const row = rows[0];
    const datos = leerDatos(row);
    const excel = await guardarExcelAudiometria({
        empresaNombre,
        folio: row.folio,
        nombre: row.nombre,
        driveFileId: row.drive_file_id,
        datos: {
            ...datos,
            tipoAudiometria: datos.tipoAudiometria || row.tipo_audiometria,
            nombre: datos.nombre || row.nombre,
            fechaElaboracion: datos.fechaElaboracion || fechaSoloDia(row.fecha_elaboracion),
            ocupacion: datos.ocupacion || row.ocupacion,
            edad: datos.edad || row.edad,
            personalElaboro: datos.personalElaboro || row.personal_elaboro,
            cedulaProfesional: datos.cedulaProfesional || row.cedula_profesional
        }
    });
    await poolMedicos.query(
        'UPDATE audiometria SET drive_file_id = ?, drive_url = ? WHERE id = ?',
        [excel.driveFileId, excel.driveUrl, id]
    );
    return excel;
}

function valorUmbral(umbrales, frecuencia, campo) {
    const item = (Array.isArray(umbrales) ? umbrales : []).find((umbral) => Number(umbral?.frecuencia) === frecuencia);
    if (!item) return null;
    const raw = item[campo];
    if (raw === null || raw === undefined || raw === '') return null;
    const numero = Number(raw);
    if (!Number.isFinite(numero) || numero < -10 || numero > 120) return null;
    return numero;
}

function operarUmbrales(umbrales, frecuencias, campo) {
    const valores = frecuencias.map((frecuencia) => valorUmbral(umbrales, frecuencia, campo));
    if (valores.every((valor) => valor == null)) return null;
    return valores.reduce((total, valor) => total + (valor ?? 0), 0);
}

function mediaOido(umbrales, lado) {
    const suma = operarUmbrales(umbrales, [1000, 1500, 2000, 4000], lado === 'Od' ? 'vaOd' : 'vaOi');
    return suma == null ? null : suma / 11;
}

function porcentajeOido(umbrales, lado) {
    const frecuencias = lado === 'Od'
        ? [125, 250, 500, 750, 1000, 1500, 2000, 3000, 4000, 6000, 8000]
        : [1000, 1500, 2000, 3000, 4000];
    const suma = operarUmbrales(umbrales, frecuencias, lado === 'Od' ? 'vaOd' : 'vaOi');
    if (suma == null) return null;
    if (suma <= 100) return 0;
    return Math.min(100, Math.max(0, Math.round((0.375 * suma) - 37.5)));
}

function porcentajeBinaural(derecho, izquierdo) {
    if (derecho == null || izquierdo == null) return null;
    if (izquierdo > derecho) return ((5 * derecho) + izquierdo) / 6;
    return ((5 * izquierdo) + derecho) / 6;
}

function grupoAuditivo(db) {
    if (db == null) return null;
    if (db > 90) return 'profunda';
    if (db > 70) return 'severa';
    if (db > 40) return 'moderada';
    if (db > 20) return 'leve';
    return 'normal';
}

function esSi(valor) {
    const texto = String(valor || '').trim().toUpperCase();
    return texto === 'SI' || texto === 'SÍ';
}

function tieneTinnitus(valor) {
    const texto = String(valor || '').trim().toUpperCase();
    if (!texto) return false;
    return texto !== 'NO' && texto !== 'N/A' && texto !== 'NA' && texto !== '-' && texto !== 'NINGUNO';
}

function claveProtector(valor) {
    const texto = String(valor || '').trim().toLowerCase();
    if (texto === 'sí' || texto === 'si') return 'si';
    if (texto === 'no') return 'no';
    if (texto === 'ocasional') return 'ocasional';
    return null;
}

function claveTipo(valor) {
    const texto = String(valor || '').trim().toLowerCase();
    if (texto.startsWith('inicial')) return 'inicial';
    if (texto.startsWith('peri')) return 'periodica';
    if (texto.startsWith('confirm')) return 'confirmacion';
    if (texto.startsWith('egreso')) return 'egreso';
    return null;
}

function claveRuido(valor) {
    const texto = String(valor || '').trim().toLowerCase();
    if (texto.startsWith('continu')) return 'continuo';
    if (texto.startsWith('intermit')) return 'intermitente';
    if (texto.includes('impacto')) return 'impacto';
    if (texto.startsWith('mixt')) return 'mixto';
    return null;
}

function resumirAudiometrias(rows) {
    const resultado = { normal: 0, leve: 0, moderada: 0, severa: 0, profunda: 0 };
    const oidos = { derecho: 0, izquierdo: 0 };
    const tipo = { inicial: 0, periodica: 0, confirmacion: 0, egreso: 0 };
    const protector = { si: 0, no: 0, ocasional: 0 };
    const ruido = { continuo: 0, intermitente: 0, impacto: 0, mixto: 0 };
    const sintomas = { disminucion: 0, tinnitus: 0, otalgia: 0, vertigo: 0, mareos: 0, otorrea: 0 };
    let clasificados = 0;
    let conProtector = 0;
    let conSintomas = 0;
    let sumaBinaural = 0;
    let conBinaural = 0;

    for (const row of rows) {
        const datos = leerDatos(row);
        const umbrales = Array.isArray(datos.umbrales) ? datos.umbrales : [];
        const derecho = mediaOido(umbrales, 'Od');
        const izquierdo = mediaOido(umbrales, 'Oi');
        const grupo = grupoAuditivo(derecho == null || izquierdo == null ? null : (derecho + izquierdo) / 2);
        if (grupo) {
            resultado[grupo] += 1;
            clasificados += 1;
        }
        if (derecho != null && derecho > 20) oidos.derecho += 1;
        if (izquierdo != null && izquierdo > 20) oidos.izquierdo += 1;

        const binaural = porcentajeBinaural(porcentajeOido(umbrales, 'Od'), porcentajeOido(umbrales, 'Oi'));
        if (binaural != null) {
            sumaBinaural += binaural;
            conBinaural += 1;
        }

        const tipoClave = claveTipo(row.tipo_audiometria || datos.tipoAudiometria);
        if (tipoClave) tipo[tipoClave] += 1;
        const protectorClave = claveProtector(datos.usoProtector);
        if (protectorClave) protector[protectorClave] += 1;
        if (protectorClave === 'si') conProtector += 1;
        const ruidoClave = claveRuido(datos.tipoRuido);
        if (ruidoClave) ruido[ruidoClave] += 1;

        const marcas = {
            disminucion: esSi(datos.disminucionAudicion),
            tinnitus: tieneTinnitus(datos.tinnitus),
            otalgia: esSi(datos.otalgia),
            vertigo: esSi(datos.vertigo),
            mareos: esSi(datos.mareos),
            otorrea: esSi(datos.otorrea)
        };
        if (Object.values(marcas).some(Boolean)) conSintomas += 1;
        Object.keys(marcas).forEach((clave) => {
            if (marcas[clave]) sintomas[clave] += 1;
        });
    }

    const total = rows.length;
    const porcentaje = (cantidad) => (total > 0 ? Math.round((cantidad / total) * 100) : 0);
    return {
        total,
        clasificados,
        pctNormal: clasificados > 0 ? Math.round((resultado.normal / clasificados) * 100) : 0,
        pctProtector: porcentaje(conProtector),
        pctSintomas: porcentaje(conSintomas),
        perdidaBinaural: conBinaural > 0 ? Math.round((sumaBinaural / conBinaural) * 10) / 10 : 0,
        resultado,
        oidos,
        tipo,
        protector,
        ruido,
        sintomas
    };
}

function registrarRutasAudiometria(app, deps) {
    const dbMedicos = deps.dbMedicos || 'medicos_biznaga';

    app.get('/api/audiometrias/empresas', async (req, res) => {
        try {
            await deps.poolMedicosReady;
            const poolMedicos = poolMedicosDe(deps);
            const pool = poolPrincipalDe(deps);
            await asegurarTabla(poolMedicos, dbMedicos);
            const [empresas] = await pool.query(`
                SELECT
                    e.empresa_id,
                    e.nombre_empresa,
                    e.rfc,
                    e.estado,
                    e.ciudad,
                    (SELECT COUNT(*) FROM \`${dbMedicos}\`.audiometria a
                     WHERE a.empresa_id = e.empresa_id AND a.activo = 1) AS audiometrias_totales
                FROM empresa e
                WHERE e.activo = TRUE
                ORDER BY e.nombre_empresa
            `);
            res.json({ success: true, empresas });
        } catch (error) {
            console.error('[ERROR] Empresas audiometría:', error.message);
            res.status(500).json({ success: false, message: 'Error al obtener empresas' });
        }
    });

    app.post('/api/audiometrias/carpeta', async (req, res) => {
        try {
            const empresa = await nombreEmpresa(
                deps,
                req.body?.empresa_id,
                req.body?.nombre_empresa
            );
            if (!empresa) {
                return res.status(404).json({ success: false, message: 'Empresa no encontrada' });
            }
            const folderId = await asegurarCarpetaAudiometrias(empresa);
            res.json({ success: true, folderId });
        } catch (error) {
            const status = error.status || error.statusCode || 500;
            console.error('[ERROR] Carpeta audiometría:', error.message);
            res.status(status).json({
                success: false,
                message: error.status || error.statusCode
                    ? error.message
                    : 'No se pudo crear la carpeta de audiometrías'
            });
        }
    });

    app.get('/api/audiometrias/estadisticas', async (req, res) => {
        try {
            await deps.poolMedicosReady;
            const poolMedicos = poolMedicosDe(deps);
            await asegurarTabla(poolMedicos, dbMedicos);
            const empresaIdRaw = req.query.empresa_id ? Number(req.query.empresa_id) : null;
            const empresaId = Number.isInteger(empresaIdRaw) && empresaIdRaw > 0 ? empresaIdRaw : null;
            let sql = 'SELECT tipo_audiometria, datos_json FROM audiometria WHERE activo = 1';
            const params = [];
            if (empresaId) {
                sql += ' AND empresa_id = ?';
                params.push(empresaId);
            }
            const [rows] = await poolMedicos.query(sql, params);
            res.json({ success: true, ...resumirAudiometrias(rows) });
        } catch (error) {
            console.error('[ERROR] Estadísticas audiometría:', error.message);
            res.status(500).json({ success: false, message: 'Error al obtener estadísticas de audiometría' });
        }
    });

    app.get('/api/audiometrias', async (req, res) => {
        try {
            await deps.poolMedicosReady;
            const poolMedicos = poolMedicosDe(deps);
            await asegurarTabla(poolMedicos, dbMedicos);
            let sql = `SELECT id, empresa_id, instructor_id, folio, tipo_audiometria, nombre,
                              fecha_elaboracion, ocupacion, edad, personal_elaboro, cedula_profesional,
                              drive_file_id, drive_url, created_at, updated_at
                       FROM audiometria WHERE activo = 1`;
            const params = [];
            if (req.query.empresa_id) {
                sql += ' AND empresa_id = ?';
                params.push(req.query.empresa_id);
            }
            sql += ' ORDER BY created_at DESC';
            const [rows] = await poolMedicos.query(sql, params);
            res.json({ success: true, audiometrias: rows.map((row) => filaPublica(row, false)) });
        } catch (error) {
            console.error('[ERROR] Listar audiometrías:', error.message);
            res.status(500).json({ success: false, message: 'Error al obtener audiometrías' });
        }
    });

    app.get('/api/audiometrias/:id', async (req, res) => {
        try {
            await deps.poolMedicosReady;
            const poolMedicos = poolMedicosDe(deps);
            await asegurarTabla(poolMedicos, dbMedicos);
            const [rows] = await poolMedicos.query(
                'SELECT * FROM audiometria WHERE id = ? AND activo = 1',
                [req.params.id]
            );
            if (!rows.length) {
                return res.status(404).json({ success: false, message: 'Audiometría no encontrada' });
            }
            res.json({ success: true, audiometria: filaPublica(rows[0], true) });
        } catch (error) {
            console.error('[ERROR] Obtener audiometría:', error.message);
            res.status(500).json({ success: false, message: 'Error al obtener la audiometría' });
        }
    });

    app.post('/api/audiometrias', async (req, res) => {
        try {
            await deps.poolMedicosReady;
            const poolMedicos = poolMedicosDe(deps);
            await asegurarTabla(poolMedicos, dbMedicos);
            const campos = camposDesdeBody(req.body || {});
            if (!campos.nombre) {
                return res.status(400).json({ success: false, message: 'El nombre es obligatorio' });
            }
            if (!campos.empresa_id) {
                return res.status(400).json({ success: false, message: 'Selecciona una empresa' });
            }
            const [result] = await poolMedicos.query('INSERT INTO audiometria SET ?', [campos]);
            const id = result.insertId;
            const folio = `AUD-${String(id).padStart(5, '0')}`;
            await poolMedicos.query('UPDATE audiometria SET folio = ? WHERE id = ?', [folio, id]);
            const empresa = await nombreEmpresa(
                deps,
                campos.empresa_id,
                req.body?.nombre_empresa
            );
            let excel = null;
            let driveError = '';
            try {
                excel = await sincronizarExcel(poolMedicos, id, empresa);
            } catch (error) {
                driveError = error.message || 'No se pudo guardar el Excel';
                console.error('[ERROR] Excel audiometría:', driveError);
            }
            res.json({
                success: true,
                id,
                folio,
                drive_url: excel?.driveUrl || null,
                drive_error: driveError || null,
                message: 'Audiometría guardada'
            });
        } catch (error) {
            const status = error.status || 500;
            console.error('[ERROR] Guardar audiometría:', error.message);
            res.status(status).json({ success: false, message: error.status ? error.message : 'Error al guardar la audiometría' });
        }
    });

    app.put('/api/audiometrias/:id', async (req, res) => {
        try {
            await deps.poolMedicosReady;
            const poolMedicos = poolMedicosDe(deps);
            await asegurarTabla(poolMedicos, dbMedicos);
            const campos = camposDesdeBody(req.body || {});
            if (!campos.nombre) {
                return res.status(400).json({ success: false, message: 'El nombre es obligatorio' });
            }
            const [result] = await poolMedicos.query(
                'UPDATE audiometria SET ? WHERE id = ? AND activo = 1',
                [campos, req.params.id]
            );
            if (!result.affectedRows) {
                return res.status(404).json({ success: false, message: 'Audiometría no encontrada' });
            }
            const [rows] = await poolMedicos.query(
                'SELECT folio, empresa_id FROM audiometria WHERE id = ?',
                [req.params.id]
            );
            const empresa = await nombreEmpresa(
                deps,
                campos.empresa_id || rows[0]?.empresa_id,
                req.body?.nombre_empresa
            );
            let excel = null;
            let driveError = '';
            try {
                excel = await sincronizarExcel(poolMedicos, req.params.id, empresa);
            } catch (error) {
                driveError = error.message || 'No se pudo actualizar el Excel';
                console.error('[ERROR] Excel audiometría:', driveError);
            }
            res.json({
                success: true,
                id: Number(req.params.id),
                folio: rows[0]?.folio || null,
                drive_url: excel?.driveUrl || null,
                drive_error: driveError || null,
                message: 'Audiometría actualizada'
            });
        } catch (error) {
            const status = error.status || 500;
            console.error('[ERROR] Actualizar audiometría:', error.message);
            res.status(status).json({ success: false, message: error.status ? error.message : 'Error al actualizar la audiometría' });
        }
    });

    app.delete('/api/audiometrias/:id', async (req, res) => {
        try {
            await deps.poolMedicosReady;
            const poolMedicos = poolMedicosDe(deps);
            await asegurarTabla(poolMedicos, dbMedicos);
            const [rows] = await poolMedicos.query(
                'SELECT drive_file_id FROM audiometria WHERE id = ?',
                [req.params.id]
            );
            await poolMedicos.query('UPDATE audiometria SET activo = 0 WHERE id = ?', [req.params.id]);
            const driveFileId = rows[0]?.drive_file_id;
            if (driveFileId) {
                try {
                    await require('./driveService').eliminarArchivo(driveFileId);
                } catch (error) {
                    console.warn('[WARN] No se pudo quitar el Excel de audiometría:', error.message);
                }
            }
            res.json({ success: true, message: 'Audiometría eliminada' });
        } catch (error) {
            console.error('[ERROR] Eliminar audiometría:', error.message);
            res.status(500).json({ success: false, message: 'Error al eliminar la audiometría' });
        }
    });
}

module.exports = { registrarRutasAudiometria };
