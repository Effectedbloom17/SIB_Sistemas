// =====================================================
// BIZNAGA R&T — Historial cuantitativo de sensores (cisterna)
// Persistencia en BD satélite `sensores` cada 30 min.
// =====================================================

const INTERVALO_MS_DEFAULT = 30 * 60 * 1000;
const DISPOSITIVO_CLAVE = 'cisterna_agua';
const startupLog = require('./startupLog');

/** DATETIME en zona America/Mexico_City (no UTC). */
function toMysqlDateTime(value) {
    if (!value) return null;
    const d = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(d.getTime())) return null;

    const parts = new Intl.DateTimeFormat('en-CA', {
        timeZone: 'America/Mexico_City',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hourCycle: 'h23'
    }).formatToParts(d);

    const get = (type) => parts.find((p) => p.type === type)?.value || '';
    return `${get('year')}-${get('month')}-${get('day')} ${get('hour')}:${get('minute')}:${get('second')}`;
}

function toNumberOrNull(value) {
    if (value === null || value === undefined || value === '') return null;
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
}

function intervaloMs() {
    const n = Number(process.env.SENSOR_HISTORIAL_MS);
    return n > 60_000 ? n : INTERVALO_MS_DEFAULT;
}

async function asegurarTablasSensores(poolSensores) {
    if (!poolSensores?.query) {
        throw new Error('Pool de sensores no disponible');
    }

    await poolSensores.query(`
        CREATE TABLE IF NOT EXISTS sensor_cisterna_lectura (
          id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
          dispositivo_clave VARCHAR(64) NOT NULL DEFAULT 'cisterna_agua',
          dispositivo_nombre VARCHAR(160) NULL,
          tomado_en DATETIME NOT NULL,
          volumen DECIMAL(8,3) NULL,
          altura DECIMAL(8,3) NULL,
          conectado TINYINT(1) NULL,
          nube_ok TINYINT(1) NOT NULL DEFAULT 0,
          lectura_ok TINYINT(1) NOT NULL DEFAULT 0,
          error_codigo VARCHAR(64) NULL,
          error_mensaje VARCHAR(500) NULL,
          latencia_ms INT NULL,
          blynk_status VARCHAR(32) NULL,
          recepcion_modo VARCHAR(24) NULL,
          ultimo_reporte_en DATETIME NULL,
          pin_volumen VARCHAR(8) NULL,
          pin_altura VARCHAR(8) NULL,
          extra_json LONGTEXT NULL,
          created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
          PRIMARY KEY (id),
          KEY idx_tomado_en (tomado_en),
          KEY idx_dispositivo_tomado (dispositivo_clave, tomado_en)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
}

async function obtenerUltimaLectura(poolSensores, dispositivoClave = DISPOSITIVO_CLAVE) {
    const [rows] = await poolSensores.query(
        `SELECT id, tomado_en, volumen, altura, lectura_ok, error_codigo
         FROM sensor_cisterna_lectura
         WHERE dispositivo_clave = ?
         ORDER BY tomado_en DESC, id DESC
         LIMIT 1`,
        [dispositivoClave]
    );
    return rows[0] || null;
}

function construirFila(estado, error) {
    const diag = estado?.diagnostics || {};
    const pins = estado?.pins || {};
    const altura = toNumberOrNull(estado?.altura ?? estado?.range);
    const volumen = toNumberOrNull(estado?.volume);
    const lecturaOk = !error
        && !!estado?.configured
        && (volumen !== null || altura !== null);

    const extra = {
        datastreams: estado?.datastreams || [],
        tokenHint: diag.tokenHint || null,
        ip: diag.ip || null,
        country: diag.country || null,
        heartbeatIntervalSec: diag.heartbeatIntervalSec ?? null,
        lastSessionDurationSec: diag.lastSessionDurationSec ?? null,
        boardType: diag.boardType || null,
        blynkVersion: diag.blynkVersion || null,
        firmwareBuild: diag.firmwareBuild || null,
        partialErrors: estado?.errors || null
    };

    return {
        dispositivo_clave: DISPOSITIVO_CLAVE,
        dispositivo_nombre: estado?.deviceName || 'sensor de agua biznaga',
        tomado_en: toMysqlDateTime(estado?.updatedAt) || toMysqlDateTime(new Date()),
        volumen,
        altura,
        conectado: typeof estado?.connected === 'boolean' ? (estado.connected ? 1 : 0) : null,
        nube_ok: diag.cloudOk ? 1 : 0,
        lectura_ok: lecturaOk ? 1 : 0,
        error_codigo: error?.code || (lecturaOk ? null : 'LECTURA_INCOMPLETA'),
        error_mensaje: error?.message
            || (lecturaOk ? null : 'La lectura no trajo volumen ni altura'),
        latencia_ms: toNumberOrNull(diag.latencyMs),
        blynk_status: diag.blynkStatus || null,
        recepcion_modo: diag.reception?.mode || null,
        ultimo_reporte_en: toMysqlDateTime(diag.lastReportedAt),
        pin_volumen: pins.volume || pins.volumen || null,
        pin_altura: pins.altura || pins.range || null,
        extra_json: JSON.stringify(extra)
    };
}

async function guardarLectura(poolSensores, estado, error = null, { forzar = false } = {}) {
    if (!poolSensores?.query) return null;

    const minGap = Math.floor(intervaloMs() * 0.8);
    if (!forzar) {
        const ultima = await obtenerUltimaLectura(poolSensores);
        if (ultima?.tomado_en) {
            const prev = new Date(ultima.tomado_en).getTime();
            if (Number.isFinite(prev) && Date.now() - prev < minGap) {
                return { skipped: true, ultima };
            }
        }
    }

    const fila = construirFila(estado || {}, error);
    const [result] = await poolSensores.query(
        `INSERT INTO sensor_cisterna_lectura (
            dispositivo_clave, dispositivo_nombre, tomado_en, volumen, altura,
            conectado, nube_ok, lectura_ok, error_codigo, error_mensaje,
            latencia_ms, blynk_status, recepcion_modo, ultimo_reporte_en,
            pin_volumen, pin_altura, extra_json
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
            fila.dispositivo_clave,
            fila.dispositivo_nombre,
            fila.tomado_en,
            fila.volumen,
            fila.altura,
            fila.conectado,
            fila.nube_ok,
            fila.lectura_ok,
            fila.error_codigo,
            fila.error_mensaje ? String(fila.error_mensaje).slice(0, 500) : null,
            fila.latencia_ms,
            fila.blynk_status,
            fila.recepcion_modo,
            fila.ultimo_reporte_en,
            fila.pin_volumen,
            fila.pin_altura,
            fila.extra_json
        ]
    );

    return { skipped: false, id: result.insertId, fila };
}

async function listarLecturas(poolSensores, { limit = 48, dispositivoClave = DISPOSITIVO_CLAVE } = {}) {
    const lim = Math.min(Math.max(Number(limit) || 48, 1), 500);
    const [rows] = await poolSensores.query(
        `SELECT id, dispositivo_clave, dispositivo_nombre, tomado_en, volumen, altura,
                conectado, nube_ok, lectura_ok, error_codigo, error_mensaje,
                latencia_ms, blynk_status, recepcion_modo, ultimo_reporte_en,
                pin_volumen, pin_altura, created_at
         FROM sensor_cisterna_lectura
         WHERE dispositivo_clave = ?
         ORDER BY tomado_en DESC, id DESC
         LIMIT ?`,
        [dispositivoClave, lim]
    );
    return rows;
}

function iniciarMuestreo({ getPool, ready, obtenerEstado }) {
    const periodo = intervaloMs();
    let enCurso = false;

    const tick = async (forzar = false) => {
        if (enCurso) return;
        enCurso = true;
        try {
            if (ready) {
                try { await ready; } catch (_e) { return; }
            }
            const poolSensores = getPool ? getPool() : null;
            if (!poolSensores?.query) return;

            let estado = null;
            let error = null;
            try {
                estado = await obtenerEstado();
            } catch (err) {
                error = err;
                estado = err.payload || {};
            }

            const resultado = await guardarLectura(poolSensores, estado, error, { forzar });
            if (!resultado?.skipped) {
                const ok = resultado?.fila?.lectura_ok ? 'ok' : 'error';
                startupLog.detail(
                    `[SENSORES] Lectura ${ok} guardada id=${resultado?.id} `
                    + `volumen=${resultado?.fila?.volumen ?? 'n/a'} `
                    + `altura=${resultado?.fila?.altura ?? 'n/a'}`
                );
            }
        } catch (err) {
            console.warn('[SENSORES] No se pudo guardar la lectura:', err.message);
        } finally {
            enCurso = false;
        }
    };

    const arranqueMs = Number(process.env.SENSOR_HISTORIAL_START_MS) > 0
        ? Number(process.env.SENSOR_HISTORIAL_START_MS)
        : 20_000;

    setTimeout(() => tick(true), arranqueMs);
    setInterval(() => tick(false), periodo);
    startupLog.detail(`  [SENSORES] Historial cada ${Math.round(periodo / 60000)} min (primera muestra en ${Math.round(arranqueMs / 1000)} s)`);
}

module.exports = {
    DISPOSITIVO_CLAVE,
    intervaloMs,
    asegurarTablasSensores,
    obtenerUltimaLectura,
    guardarLectura,
    listarLecturas,
    iniciarMuestreo
};
