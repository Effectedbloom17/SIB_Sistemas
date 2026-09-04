/**
 * Sincroniza solo el catálogo de Inventario (innovacion_inventario)
 * y materiales base (innovacion_material) desde la referencia Word.
 *
 * Uso:
 *   node scripts/sync-innovacion-inventario.js              # desarrollo (.env)
 *   node scripts/sync-innovacion-inventario.js --produccion  # producción (.env.produccion)
 */
const path = require('path');
const fs = require('fs');

const usarProduccion = process.argv.includes('--produccion');
const envFile = usarProduccion ? '.env.produccion' : '.env';
const envPath = path.join(__dirname, '..', envFile);

if (!fs.existsSync(envPath)) {
    console.error(`No existe ${envFile}`);
    process.exit(1);
}

require('dotenv').config({ path: envPath, quiet: true });
const mysql = require('mysql2/promise');
const inventarios = require('../innovacionInventarioService');
const materiales = require('../innovacionMaterialService');

async function main() {
    const host = usarProduccion
        ? (process.env.DB_HOST_REMOTE || process.env.DB_HOST_LOCAL)
        : (process.env.DB_HOST_LOCAL || '127.0.0.1');
    const database = process.env.DB_NAME_SGC;
    if (!host || !database || !process.env.DB_USER) {
        throw new Error('Faltan variables DB_* / DB_NAME_SGC');
    }

    console.log(`[sync-inventario] entorno=${usarProduccion ? 'produccion' : 'desarrollo'}`);
    console.log(`[sync-inventario] host=${host} db=${database}`);

    const conn = await mysql.createConnection({
        host,
        port: Number(process.env.DB_PORT || 3306),
        user: process.env.DB_USER,
        password: process.env.DB_PASS,
        database,
        connectTimeout: 15000
    });

    try {
        const [[antes]] = await conn.query('SELECT COUNT(*) AS total FROM innovacion_inventario').catch(() => [[{ total: 0 }]]);
        console.log(`[sync-inventario] filas inventario antes: ${antes?.total ?? 0}`);

        await materiales.asegurarTablaInnovacionMaterial(conn);
        await inventarios.asegurarTablaInnovacionInventario(conn);

        const [[despues]] = await conn.query('SELECT COUNT(*) AS total FROM innovacion_inventario');
        const [mats] = await conn.query(
            `SELECT slug, label FROM innovacion_material
             WHERE slug IN ('trovicel','acrilico','coroplast','etiquetas_impresion_en_vinil','fotoluminiscente')
             ORDER BY label`
        );
        const [porMaterial] = await conn.query(
            `SELECT material, COUNT(*) AS tipos, SUM(cantidad) AS piezas
             FROM innovacion_inventario
             GROUP BY material
             ORDER BY material`
        );

        console.log(`[sync-inventario] filas inventario despues: ${despues.total}`);
        console.log('[sync-inventario] materiales base:', mats.map(m => m.label).join(', '));
        console.log('[sync-inventario] resumen por material:');
        for (const row of porMaterial) {
            console.log(`  - ${row.material}: ${row.tipos} tipos, ${row.piezas} piezas`);
        }
        console.log('[sync-inventario] OK (solo INSERT IGNORE; no se modificaron registros existentes).');
    } finally {
        await conn.end();
    }
}

main().catch((err) => {
    console.error('[sync-inventario] ERROR:', err.message || err);
    process.exit(1);
});
