// =====================================================
// BIZNAGA R&T - Blynk IoT Service
// Lectura de sensores vía Blynk External API
// =====================================================

const axios = require('axios');

const DEFAULT_SERVER = 'https://blynk.cloud';
// Plantilla Blynk "sensor de agua biznaga": Volume = v0, Range = v1
const DEFAULT_VOLUME_PIN = 'v0';
const DEFAULT_RANGE_PIN = 'v1';
const DEFAULT_DEVICE_NAME = 'Sensor de agua';
const DEFAULT_TIMEOUT_MS = 8000;

function normalizarPin(pin, fallback) {
    const raw = String(pin || fallback || '').trim().toLowerCase();
    if (!raw) return fallback;
    if (/^v\d+$/i.test(raw)) return raw;
    if (/^\d+$/.test(raw)) return `v${raw}`;
    return fallback;
}

function tokenHint(token) {
    const t = String(token || '').trim();
    if (t.length < 4) return null;
    return `····${t.slice(-4)}`;
}

function toIsoFromBlynkTs(value) {
    const n = Number(value);
    if (!Number.isFinite(n) || n <= 0) return null;
    const ms = n < 1e12 ? n * 1000 : n;
    const d = new Date(ms);
    if (Number.isNaN(d.getTime())) return null;
    return d.toISOString();
}

function obtenerConfig() {
    const token = String(process.env.BLYNK_AUTH_TOKEN || '').trim();
    const server = String(process.env.BLYNK_SERVER || DEFAULT_SERVER).trim().replace(/\/+$/, '') || DEFAULT_SERVER;
    const volumePin = normalizarPin(process.env.BLYNK_VOLUME_PIN, DEFAULT_VOLUME_PIN);
    const alturaPin = normalizarPin(
        process.env.BLYNK_ALTURA_PIN || process.env.BLYNK_RANGE_PIN || process.env.BLYNK_VOLTAGE_PIN,
        DEFAULT_RANGE_PIN
    );
    const deviceName = String(process.env.BLYNK_DEVICE_NAME || DEFAULT_DEVICE_NAME).trim() || DEFAULT_DEVICE_NAME;
    const timeoutMs = Number(process.env.BLYNK_TIMEOUT_MS) > 0
        ? Number(process.env.BLYNK_TIMEOUT_MS)
        : DEFAULT_TIMEOUT_MS;

    return {
        configured: !!token,
        server,
        volumePin,
        alturaPin,
        rangePin: alturaPin,
        deviceName,
        timeoutMs,
        token,
        tokenHint: tokenHint(token)
    };
}

/**
 * Parsea respuestas de Blynk (string | number | boolean | JSON).
 * No registra el token.
 */
function parseBlynkValue(raw) {
    if (raw === null || raw === undefined) {
        return { raw: null, number: null, boolean: null };
    }

    if (typeof raw === 'boolean') {
        return { raw, number: raw ? 1 : 0, boolean: raw };
    }

    if (typeof raw === 'number' && Number.isFinite(raw)) {
        return { raw, number: raw, boolean: raw !== 0 };
    }

    let value = raw;
    if (typeof raw === 'object') {
        try {
            value = JSON.stringify(raw);
        } catch (_e) {
            value = String(raw);
        }
    }

    const text = String(value).trim();
    if (!text || text.toLowerCase() === 'null' || text.toLowerCase() === 'undefined') {
        return { raw: null, number: null, boolean: null };
    }

    const lower = text.toLowerCase();
    if (lower === 'true' || lower === 'yes' || lower === 'online' || lower === 'connected') {
        return { raw: true, number: 1, boolean: true };
    }
    if (lower === 'false' || lower === 'no' || lower === 'offline' || lower === 'disconnected') {
        return { raw: false, number: 0, boolean: false };
    }

    if ((text.startsWith('[') && text.endsWith(']')) || (text.startsWith('{') && text.endsWith('}'))) {
        try {
            const parsed = JSON.parse(text);
            if (Array.isArray(parsed) && parsed.length > 0) {
                return parseBlynkValue(parsed[0]);
            }
            if (parsed && typeof parsed === 'object') {
                if (parsed.value !== undefined) return parseBlynkValue(parsed.value);
                if (parsed.result !== undefined) return parseBlynkValue(parsed.result);
            }
        } catch (_e) {
            // continuar con parseo numérico
        }
    }

    const num = Number(text.replace(',', '.'));
    if (Number.isFinite(num)) {
        return { raw: num, number: num, boolean: num !== 0 };
    }

    return { raw: text, number: null, boolean: null };
}

function crearCliente(config) {
    return axios.create({
        baseURL: config.server,
        timeout: config.timeoutMs,
        validateStatus: () => true
    });
}

function assertOk(response, label) {
    if (response.status >= 400) {
        const err = new Error(`Blynk ${label} HTTP ${response.status}`);
        err.statusCode = response.status;
        throw err;
    }
}

async function getIsHardwareConnected(config) {
    const client = crearCliente(config);
    const response = await client.get('/external/api/isHardwareConnected', {
        params: { token: config.token }
    });
    assertOk(response, 'isHardwareConnected');

    const parsed = parseBlynkValue(response.data);
    if (parsed.boolean !== null) return parsed.boolean;
    if (parsed.number !== null) return parsed.number !== 0;
    return null;
}

async function getAllDatastreams(config) {
    const client = crearCliente(config);
    const response = await client.get('/external/api/getAll', {
        params: { token: config.token }
    });
    assertOk(response, 'getAll');

    const data = response.data;
    if (!data || typeof data !== 'object' || Array.isArray(data)) {
        return {};
    }

    const out = {};
    for (const [key, value] of Object.entries(data)) {
        const pin = String(key || '').trim().toLowerCase();
        if (!pin) continue;
        const parsed = parseBlynkValue(value);
        out[pin] = parsed.number !== null ? parsed.number : parsed.raw;
    }
    return out;
}

function sanitizarDispositivo(raw) {
    if (!raw || typeof raw !== 'object') return null;
    const hw = raw.hardwareInfo && typeof raw.hardwareInfo === 'object' ? raw.hardwareInfo : {};
    const ipInfo = raw.ipInfo && typeof raw.ipInfo === 'object' ? raw.ipInfo : {};
    const connectTime = toIsoFromBlynkTs(raw.connectTime);
    const disconnectTime = toIsoFromBlynkTs(raw.disconnectTime);
    let lastSessionDurationSec = null;
    const connectMs = Number(raw.connectTime);
    const disconnectMs = Number(raw.disconnectTime);
    if (Number.isFinite(connectMs) && Number.isFinite(disconnectMs) && disconnectMs > connectMs && connectMs > 0) {
        lastSessionDurationSec = Math.round((disconnectMs - connectMs) / 1000);
    }

    return {
        name: raw.name ? String(raw.name) : null,
        status: raw.status ? String(raw.status) : null,
        lastReportedAt: toIsoFromBlynkTs(raw.lastReportedAt || raw.updatedAt),
        lastConnectedAt: connectTime,
        lastDisconnectedAt: disconnectTime,
        lastSessionDurationSec,
        activatedAt: toIsoFromBlynkTs(raw.activatedAt),
        ip: ipInfo.ip ? String(ipInfo.ip) : null,
        country: ipInfo.country ? String(ipInfo.country) : null,
        boardType: hw.boardType ? String(hw.boardType) : null,
        blynkVersion: hw.blynkVersion ? String(hw.blynkVersion) : null,
        firmwareBuild: hw.build ? String(hw.build) : null,
        heartbeatIntervalSec: Number(hw.heartbeatInterval) > 0 ? Number(hw.heartbeatInterval) : null
    };
}

async function getDeviceInfo(config) {
    const client = crearCliente(config);
    const response = await client.get('/external/api/device', {
        params: { token: config.token }
    });
    assertOk(response, 'device');
    return sanitizarDispositivo(response.data);
}

function clasificarRecepcion({ connected, lastReportedAt, hasValues }) {
    const ageSec = lastReportedAt
        ? Math.max(0, Math.round((Date.now() - new Date(lastReportedAt).getTime()) / 1000))
        : null;

    if (connected === true) {
        return {
            mode: 'live',
            label: 'El hardware está en línea y Blynk está recibiendo datos.',
            ageSec
        };
    }
    if (hasValues) {
        return {
            mode: 'cached',
            label: 'El hardware está desconectado. Blynk conserva la última lectura en la nube.',
            ageSec
        };
    }
    return {
        mode: 'none',
        label: 'No hay lecturas disponibles en Blynk.',
        ageSec
    };
}

function valorPin(datastreams, pin) {
    if (!datastreams || typeof datastreams !== 'object') return null;
    const key = String(pin || '').toLowerCase();
    if (!Object.prototype.hasOwnProperty.call(datastreams, key)) return null;
    const n = Number(datastreams[key]);
    return Number.isFinite(n) ? n : null;
}

/**
 * Obtiene estado saneado del dispositivo (sin token).
 * Un pin fallido no impide devolver el otro.
 */
async function obtenerEstadoSensor() {
    const config = obtenerConfig();
    const updatedAt = new Date().toISOString();
    const base = {
        configured: config.configured,
        deviceName: config.deviceName,
        connected: null,
        volume: null,
        altura: null,
        range: null,
        pins: {
            volume: config.volumePin,
            altura: config.alturaPin,
            range: config.alturaPin
        },
        datastreams: [],
        updatedAt,
        diagnostics: {
            cloudOk: false,
            latencyMs: null,
            tokenHint: config.tokenHint,
            server: config.server,
            blynkStatus: null,
            lastReportedAt: null,
            lastConnectedAt: null,
            lastDisconnectedAt: null,
            lastSessionDurationSec: null,
            activatedAt: null,
            ip: null,
            country: null,
            boardType: null,
            blynkVersion: null,
            firmwareBuild: null,
            heartbeatIntervalSec: null,
            reception: {
                mode: 'none',
                label: config.configured
                    ? 'Sin datos de recepción todavía.'
                    : 'Blynk no está configurado en el servidor.',
                ageSec: null
            }
        },
        errors: {}
    };

    if (!config.configured) {
        const err = new Error('Blynk no está configurado. Defina BLYNK_AUTH_TOKEN en el entorno del servidor.');
        err.statusCode = 503;
        err.code = 'BLYNK_NOT_CONFIGURED';
        err.payload = base;
        throw err;
    }

    const started = Date.now();
    const [connectedResult, streamsResult, deviceResult] = await Promise.allSettled([
        getIsHardwareConnected(config),
        getAllDatastreams(config),
        getDeviceInfo(config)
    ]);
    base.diagnostics.latencyMs = Date.now() - started;

    const anyOk = [connectedResult, streamsResult, deviceResult].some((r) => r.status === 'fulfilled');
    base.diagnostics.cloudOk = anyOk;

    if (connectedResult.status === 'fulfilled') {
        base.connected = connectedResult.value;
    } else {
        base.errors.connected = 'No se pudo obtener el estado de conexión';
    }

    let datastreams = {};
    if (streamsResult.status === 'fulfilled') {
        datastreams = streamsResult.value || {};
        base.volume = valorPin(datastreams, config.volumePin);
        base.altura = valorPin(datastreams, config.alturaPin);
        base.range = base.altura;
        base.datastreams = Object.keys(datastreams)
            .sort()
            .map((pin) => ({
                pin,
                value: datastreams[pin],
                role: pin === config.volumePin ? 'volume' : pin === config.alturaPin ? 'altura' : null
            }));
    } else {
        base.errors.datastreams = 'No se pudieron leer los datastreams';
    }

    if (deviceResult.status === 'fulfilled' && deviceResult.value) {
        const device = deviceResult.value;
        if (device.name) base.deviceName = device.name;
        base.diagnostics.blynkStatus = device.status;
        base.diagnostics.lastReportedAt = device.lastReportedAt;
        base.diagnostics.lastConnectedAt = device.lastConnectedAt;
        base.diagnostics.lastDisconnectedAt = device.lastDisconnectedAt;
        base.diagnostics.lastSessionDurationSec = device.lastSessionDurationSec;
        base.diagnostics.activatedAt = device.activatedAt;
        base.diagnostics.ip = device.ip;
        base.diagnostics.country = device.country;
        base.diagnostics.boardType = device.boardType;
        base.diagnostics.blynkVersion = device.blynkVersion;
        base.diagnostics.firmwareBuild = device.firmwareBuild;
        base.diagnostics.heartbeatIntervalSec = device.heartbeatIntervalSec;
        if (base.connected === null && typeof device.status === 'string') {
            base.connected = device.status.toUpperCase() === 'ONLINE';
        }
    } else {
        base.errors.device = 'No se pudo leer el metadato del dispositivo';
    }

    const hasValues = base.volume !== null || base.altura !== null || base.datastreams.length > 0;
    base.diagnostics.reception = clasificarRecepcion({
        connected: base.connected,
        lastReportedAt: base.diagnostics.lastReportedAt,
        hasValues
    });

    if (
        connectedResult.status === 'rejected' &&
        streamsResult.status === 'rejected' &&
        deviceResult.status === 'rejected'
    ) {
        const err = new Error('No se pudo consultar Blynk. Verifique la conectividad o la configuración.');
        err.statusCode = 502;
        err.code = 'BLYNK_UNAVAILABLE';
        err.payload = base;
        throw err;
    }

    return base;
}

module.exports = {
    obtenerConfig,
    obtenerEstadoSensor,
    parseBlynkValue,
    normalizarPin
};
