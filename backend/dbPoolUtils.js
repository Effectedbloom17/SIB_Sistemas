'use strict';

const DB_TRANSIENT_ERROR_CODES = new Set([
    'ECONNRESET',
    'ETIMEDOUT',
    'PROTOCOL_CONNECTION_LOST',
    'ECONNREFUSED',
    'PROTOCOL_ENQUEUE_AFTER_FATAL_ERROR'
]);

function esErrorConexionDb(error) {
    const codigo = String(error?.code || '').toUpperCase();
    if (DB_TRANSIENT_ERROR_CODES.has(codigo)) return true;

    const mensaje = String(error?.message || '').toLowerCase();
    return mensaje.includes('read econnreset')
        || mensaje.includes('write econnreset')
        || mensaje.includes('connect etimedout')
        || mensaje.includes('connection lost')
        || mensaje.includes('cannot enqueue')
        || mensaje.includes('closed state');
}

function buildMysqlPoolOptions({ host, port, user, password, database, connectionLimit = 10, connectTimeout = 15000 }) {
    return {
        host,
        port,
        user,
        password,
        database,
        waitForConnections: true,
        connectionLimit,
        queueLimit: 0,
        connectTimeout: Number(connectTimeout) > 0 ? Number(connectTimeout) : 15000,
        enableKeepAlive: true,
        keepAliveInitialDelay: 10000,
        // Reciclar conexiones idle antes de que GoDaddy/red las cierre (ECONNRESET).
        maxIdle: Math.min(connectionLimit, 3),
        idleTimeout: 45000
    };
}

function wrapPoolWithRetry(poolInstance, { getPool, reinit, label = 'pool', retries = 2 }) {
    if (!poolInstance || poolInstance.__queryRetryWrapped) {
        return poolInstance;
    }

    const nativeQuery = poolInstance.query.bind(poolInstance);
    poolInstance.__nativeQuery = nativeQuery;

    poolInstance.query = async function resilientQuery(sql, params) {
        let intento = 0;

        while (true) {
            try {
                const activePool = getPool ? getPool() : poolInstance;
                const queryFn = activePool?.__nativeQuery || nativeQuery;
                return await queryFn.call(activePool, sql, params);
            } catch (error) {
                const esTransitorio = esErrorConexionDb(error);
                if (!esTransitorio || intento >= retries) {
                    throw error;
                }

                intento += 1;
                const code = error?.code || 'DB_ERROR';
                console.warn(`[DB][RETRY] ${label} fallo con ${code}. Reintento ${intento}/${retries}.`);
                await reinit(code);
            }
        }
    };

    poolInstance.__queryRetryWrapped = true;
    return poolInstance;
}

module.exports = {
    DB_TRANSIENT_ERROR_CODES,
    esErrorConexionDb,
    buildMysqlPoolOptions,
    wrapPoolWithRetry
};
