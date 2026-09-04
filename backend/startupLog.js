'use strict';

const LOG_LEVELS = { OFF: 0, ERROR: 1, WARN: 2, INFO: 3, DEBUG: 4 };
const LOG_LEVEL = LOG_LEVELS[(process.env.LOG_LEVEL || 'INFO').toUpperCase()] || LOG_LEVELS.INFO;

const databases = new Map();
const services = [];
let mysqlInfo = '';
let flushed = false;

function isDebug() {
    return LOG_LEVEL >= LOG_LEVELS.DEBUG;
}

function detail(msg) {
    if (isDebug()) console.log(msg);
}

function setMysqlInfo(line) {
    mysqlInfo = line;
}

function dbOk(name) {
    databases.set(name, { ok: true });
}

function dbFail(name, err) {
    databases.set(name, {
        ok: false,
        error: err?.message || String(err || 'error de conexión')
    });
}

function upsertService(item) {
    const idx = services.findIndex((s) => s.label === item.label);
    if (idx >= 0) services[idx] = item;
    else services.push(item);
}

function serviceOk(label, extra) {
    upsertService({ label, ok: true, extra: extra || '' });
}

function serviceFail(label, extra) {
    upsertService({ label, ok: false, extra: extra || 'error' });
}

function flush({ port, dbName } = {}) {
    if (flushed) return;
    flushed = true;

    console.log('');
    console.log('  BIZNAGA R&T');
    if (port) console.log(`  Servidor: http://localhost:${port}`);
    if (dbName) console.log(`  Base de datos principal: ${dbName}`);
    if (mysqlInfo) console.log(`  MySQL: ${mysqlInfo}`);
    console.log('  ----------------------------------------');

    const dbEntries = [...databases.entries()];
    const failed = dbEntries.filter(([, v]) => !v.ok);
    if (dbEntries.length === 0) {
        console.error('  Bases de datos: sin conexión');
    } else if (failed.length === 0) {
        console.log('  Bases de datos conectadas sin errores');
    } else {
        for (const [name, v] of failed) {
            console.error(`  Base de datos ${name}: error de conexión`);
            if (v.error) console.error(`    ${v.error}`);
        }
        const okNames = dbEntries.filter(([, v]) => v.ok).map(([n]) => n);
        if (okNames.length) {
            console.log(`  Bases de datos correctas: ${okNames.join(', ')}`);
        }
    }

    for (const s of services) {
        if (s.ok) {
            console.log(`  ${s.label}: listo${s.extra ? ` (${s.extra})` : ''}`);
        } else {
            console.error(`  ${s.label}: error${s.extra ? ` (${s.extra})` : ''}`);
        }
    }
    console.log('');
}

module.exports = {
    isDebug,
    detail,
    setMysqlInfo,
    dbOk,
    dbFail,
    serviceOk,
    serviceFail,
    flush
};
