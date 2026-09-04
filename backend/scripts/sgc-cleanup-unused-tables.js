const path = require('path');
const mysql = require('mysql2/promise');

require('dotenv').config({
    path: path.join(__dirname, '..', process.env.ENV_FILE || '.env'),
    quiet: true
});

const DB_NAME_SGC = process.env.DB_NAME_SGC || 'biznaga_sgc';
const BACKUP_DB = process.env.DB_NAME_SGC_BACKUP || 'biznaga_sgc_backup';
const BACKUP_TABLE_PREFIX = String(process.env.DB_BACKUP_TABLE_PREFIX || '').trim();
const EXCLUDE_PREFIXES = String(process.env.SGC_CLEANUP_EXCLUDE_PREFIXES || 'bkp_')
    .split(',')
    .map((x) => x.trim())
    .filter(Boolean);

const KEEP_TABLES = [
    'ambiental_control_oficios',
    'ambiental_control_tramites',
    'ambiental_meta',
    'ambiental_spf28_empresa',
    'pc_control_resolutivos',
    'sgc_auditoria',
    'sgc_control_proyectos',
    'sgc_documentacion_extra',
    'sgc_formato_cabecera',
    'sgc_formato_campos',
    'sgc_formato_catalogo_campos',
    'sgc_formato_metadatos',
    'sgc_formato_rutas_criticas'
];

function parseArgs() {
    const args = new Set(process.argv.slice(2));
    return {
        execute: args.has('--execute'),
        onlyEmpty: args.has('--only-empty')
    };
}

async function connect() {
    const user = process.env.DB_USER;
    const password = process.env.DB_PASS;

    const local = {
        host: process.env.DB_HOST_LOCAL,
        port: Number(process.env.DB_PORT_LOCAL || process.env.DB_PORT || 3306)
    };
    const remote = {
        host: process.env.DB_HOST_REMOTE,
        port: Number(process.env.DB_PORT_REMOTE || process.env.DB_PORT || 3306)
    };

    for (const mode of ['local', 'remote']) {
        const endpoint = mode === 'local' ? local : remote;
        try {
            const conn = await mysql.createConnection({
                host: endpoint.host,
                port: endpoint.port,
                user,
                password,
                database: DB_NAME_SGC,
                connectTimeout: 8000
            });
            return { conn, mode, endpoint };
        } catch (_err) {
            // Intentar siguiente endpoint
        }
    }

    throw new Error('No fue posible conectar a MySQL (local ni remoto).');
}

async function getBaseTables(conn) {
    const [rows] = await conn.query(`
        SELECT TABLE_NAME, COALESCE(TABLE_ROWS, 0) AS TABLE_ROWS
        FROM information_schema.TABLES
        WHERE TABLE_SCHEMA = DATABASE()
          AND TABLE_TYPE = 'BASE TABLE'
        ORDER BY TABLE_NAME
    `);
    return rows.map((r) => ({ table: r.TABLE_NAME, estRows: Number(r.TABLE_ROWS || 0) }));
}

function isExcludedByPrefix(tableName) {
    return EXCLUDE_PREFIXES.some((prefix) => tableName.startsWith(prefix));
}

async function backupTable(conn, tableName) {
    const useBackupPrefixInSameDb = Boolean(BACKUP_TABLE_PREFIX);
    const backupDb = useBackupPrefixInSameDb ? DB_NAME_SGC : BACKUP_DB;
    const backupTableName = useBackupPrefixInSameDb ? `${BACKUP_TABLE_PREFIX}${tableName}` : tableName;

    if (backupDb !== DB_NAME_SGC) {
        await conn.query(`CREATE DATABASE IF NOT EXISTS \`${backupDb}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
    }

    await conn.query(`DROP TABLE IF EXISTS \`${backupDb}\`.\`${backupTableName}\``);
    await conn.query(`CREATE TABLE \`${backupDb}\`.\`${backupTableName}\` LIKE \`${DB_NAME_SGC}\`.\`${tableName}\``);
    await conn.query(`INSERT INTO \`${backupDb}\`.\`${backupTableName}\` SELECT * FROM \`${DB_NAME_SGC}\`.\`${tableName}\``);

    return {
        backupDb,
        backupTableName
    };
}

async function dropTable(conn, tableName) {
    await conn.query(`DROP TABLE IF EXISTS \`${DB_NAME_SGC}\`.\`${tableName}\``);
}

async function main() {
    const opts = parseArgs();
    const keepSet = new Set(KEEP_TABLES);

    const { conn, mode, endpoint } = await connect();
    try {
        const tables = await getBaseTables(conn);
        const existingNames = new Set(tables.map((t) => t.table));
        const keepExisting = KEEP_TABLES.filter((t) => existingNames.has(t));
        const missingKeep = KEEP_TABLES.filter((t) => !existingNames.has(t));

        const candidates = tables.filter((t) => !keepSet.has(t.table) && !isExcludedByPrefix(t.table));
        const selected = opts.onlyEmpty ? candidates.filter((t) => t.estRows === 0) : candidates;

        console.log(`Conectado a ${DB_NAME_SGC} via ${mode} (${endpoint.host}:${endpoint.port})`);
        if (BACKUP_TABLE_PREFIX) {
            console.log(`Respaldo en misma BD con prefijo: ${BACKUP_TABLE_PREFIX}*`);
        } else {
            console.log(`Respaldo en BD: ${BACKUP_DB}`);
        }
        if (EXCLUDE_PREFIXES.length) {
            console.log(`Prefijos protegidos de limpieza: ${EXCLUDE_PREFIXES.join(', ')}`);
        }
        console.log(`Total tablas: ${tables.length}`);
        console.log(`Tablas KEEP existentes: ${keepExisting.length}`);
        console.log(`Tablas KEEP faltantes: ${missingKeep.length}`);

        if (missingKeep.length) {
            console.log('KEEP faltantes:', missingKeep.join(', '));
        }

        console.log(`Candidatas a eliminar: ${candidates.length}`);
        if (opts.onlyEmpty) {
            console.log(`Candidatas filtradas (solo vacias estimadas): ${selected.length}`);
        }

        if (!selected.length) {
            console.log('No hay tablas para eliminar con el criterio actual.');
            return;
        }

        console.log('Lista de candidatas:');
        selected.forEach((t) => console.log(` - ${t.table} (rows_est=${t.estRows})`));

        if (!opts.execute) {
            console.log('Modo simulacion. Usa --execute para respaldar + eliminar.');
            return;
        }

        await conn.query('SET FOREIGN_KEY_CHECKS = 0');
        try {
            for (const t of selected) {
                const backup = await backupTable(conn, t.table);
                await dropTable(conn, t.table);
                console.log(`OK ${t.table}: respaldada en ${backup.backupDb}.${backup.backupTableName} y eliminada de ${DB_NAME_SGC}`);
            }
        } finally {
            await conn.query('SET FOREIGN_KEY_CHECKS = 1');
        }

        console.log(`Proceso completado. Tablas eliminadas: ${selected.length}`);
    } finally {
        await conn.end();
    }
}

main().catch((err) => {
    console.error('[ERROR]', err.message);
    process.exit(1);
});
