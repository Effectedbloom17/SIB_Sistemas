require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const mysql = require('mysql2/promise');

(async () => {
    const pool = await mysql.createPool({
        host: process.env.DB_HOST_LOCAL,
        user: process.env.DB_USER,
        password: process.env.DB_PASS,
        database: process.env.DB_NAME_PC || 'proteccion_civil'
    });

    const [tot] = await pool.query(
        'SELECT origen, COUNT(*) AS c FROM pc_control_resolutivos WHERE activo = 1 GROUP BY origen'
    );
    console.log('por origen', tot);

    const [tiz] = await pool.query(
        `SELECT item, nombre_empresa, tipo_tramite, municipio, origen
         FROM pc_control_resolutivos
         WHERE activo = 1
           AND (
             municipio LIKE '%Tizayuca%'
             OR nombre_empresa LIKE '%TIZAYUCA%'
             OR nombre_empresa LIKE '%Multiservicios Mesa%'
           )
         ORDER BY item
         LIMIT 25`
    );
    console.log('muestra', tiz);

    const [cnt] = await pool.query(
        'SELECT COUNT(*) AS total FROM pc_control_resolutivos WHERE activo = 1'
    );
    console.log('total activos', cnt[0]);

    await pool.end();
})().catch((e) => {
    console.error(e);
    process.exit(1);
});
