-- Limpieza segura de tablas no usadas en biznaga_sgc
-- Uso recomendado:
-- 1) Ejecuta secciones 1 y 2 para revisar candidatas.
-- 2) Si la lista es correcta, ejecuta la seccion 3 para generar respaldos.
-- 3) Ejecuta los DROP generados en la seccion 4.

USE biznaga_sgc;

-- -----------------------------------------------------
-- 1) Lista blanca: tablas activas detectadas en backend
-- -----------------------------------------------------
DROP TEMPORARY TABLE IF EXISTS tmp_sgc_keep_tables;
CREATE TEMPORARY TABLE tmp_sgc_keep_tables (
    table_name VARCHAR(128) NOT NULL PRIMARY KEY
);

INSERT INTO tmp_sgc_keep_tables (table_name) VALUES
    ('ambiental_control_oficios'),
    ('ambiental_control_tramites'),
    ('ambiental_meta'),
    ('ambiental_spf28_empresa'),
    ('pc_control_resolutivos'),
    ('sgc_auditoria'),
    ('sgc_control_proyectos'),
    ('sgc_documentacion_extra'),
    ('sgc_formato_cabecera'),
    ('sgc_formato_campos'),
    ('sgc_formato_catalogo_campos'),
    ('sgc_formato_metadatos'),
    ('sgc_formato_rutas_criticas');

-- -----------------------------------------------------
-- 2) Inventario de candidatas (no ejecuta borrados)
-- -----------------------------------------------------
DROP TEMPORARY TABLE IF EXISTS tmp_sgc_candidate_tables;
CREATE TEMPORARY TABLE tmp_sgc_candidate_tables AS
SELECT
    t.table_name,
    COALESCE(t.table_rows, 0) AS table_rows_est,
    t.engine,
    t.create_time,
    t.update_time,
    (
        SELECT COUNT(*)
        FROM information_schema.KEY_COLUMN_USAGE k
        WHERE k.TABLE_SCHEMA = t.TABLE_SCHEMA
          AND k.TABLE_NAME = t.TABLE_NAME
          AND k.REFERENCED_TABLE_NAME IS NOT NULL
    ) AS fk_hacia_otras,
    (
        SELECT COUNT(*)
        FROM information_schema.KEY_COLUMN_USAGE k
        WHERE k.TABLE_SCHEMA = t.TABLE_SCHEMA
          AND k.REFERENCED_TABLE_NAME = t.TABLE_NAME
    ) AS fk_desde_otras
FROM information_schema.TABLES t
WHERE t.TABLE_SCHEMA = DATABASE()
  AND t.TABLE_TYPE = 'BASE TABLE'
  AND NOT EXISTS (
      SELECT 1
      FROM tmp_sgc_keep_tables k
      WHERE k.table_name = t.table_name
  );

-- Vista completa de candidatas
SELECT *
FROM tmp_sgc_candidate_tables
ORDER BY table_name;

-- Vista enfocada a prefijos legacy (como los de tu captura)
SELECT *
FROM tmp_sgc_candidate_tables
WHERE table_name REGEXP '^(dg_|main_|qms_|rh_|ops_)'
ORDER BY table_name;

-- -----------------------------------------------------
-- 3) Generar SQL de respaldo (copia a biznaga_sgc_backup)
-- -----------------------------------------------------
CREATE DATABASE IF NOT EXISTS biznaga_sgc_backup
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;

SELECT CONCAT(
    'DROP TABLE IF EXISTS `biznaga_sgc_backup`.`', table_name, '`; ',
    'CREATE TABLE `biznaga_sgc_backup`.`', table_name, '` LIKE `biznaga_sgc`.`', table_name, '`; ',
    'INSERT INTO `biznaga_sgc_backup`.`', table_name, '` SELECT * FROM `biznaga_sgc`.`', table_name, '`;'
) AS sql_respaldo
FROM tmp_sgc_candidate_tables
ORDER BY table_name;

-- -----------------------------------------------------
-- 4) Generar SQL de borrado (ejecutar solo tras respaldo)
-- -----------------------------------------------------
-- Opcion A: solo tablas estimadas en 0 filas
SELECT CONCAT('DROP TABLE IF EXISTS `biznaga_sgc`.`', table_name, '`;') AS sql_drop
FROM tmp_sgc_candidate_tables
WHERE table_rows_est = 0
ORDER BY table_name;

-- Opcion B: todas las candidatas no incluidas en keep
SELECT CONCAT('DROP TABLE IF EXISTS `biznaga_sgc`.`', table_name, '`;') AS sql_drop
FROM tmp_sgc_candidate_tables
ORDER BY table_name;
