-- =====================================================
-- BIZNAGA R&T - Seed de Produccion (Migracion Limpia)
-- =====================================================
-- Este script inicializa una base de datos LIMPIA con todos
-- los datos base que el sistema necesita para funcionar.
--
-- PREREQUISITO: La base de datos debe existir y tener las
-- tablas creadas (ejecutar primero el schema/migration).
--
-- USO:
--   mysql -u biznaga -p biznaga < seed-produccion.sql
--
-- USUARIOS CREADOS:
--   1. root / BizRoot2026!       → Super Administrador
--   2. calidad / BizCalidad2026! → Responsable de Calidad
--
-- IMPORTANTE: Cambiar ambas passwords despues del primer login.
-- =====================================================

SET FOREIGN_KEY_CHECKS = 0;

-- Limpiar tablas de datos base (TRUNCATE resetea auto_increment,
-- CRITICO porque dc3Service.js depende de area_id 1-7)
TRUNCATE TABLE usuario_areas;
TRUNCATE TABLE instructor_areas;
TRUNCATE TABLE instructor;
TRUNCATE TABLE usuario;
TRUNCATE TABLE configuracion;
TRUNCATE TABLE area_tematica;
TRUNCATE TABLE sector_empresarial;
TRUNCATE TABLE roles;

SET FOREIGN_KEY_CHECKS = 1;

-- ─────────────────────────────────────────────────────
-- 1. ROLES
-- El sistema depende de estos nombre_rol exactos:
--   root, administrador, instructor, empresa, consulta, doctor, proteccion_civil, sgc, ambiental, iot, innovacion, control_documental, rrhh, mantenimiento
-- NUNCA cambiar los nombres, solo las descripciones/permisos.
-- ─────────────────────────────────────────────────────
INSERT INTO roles (nombre_rol, descripcion, permisos) VALUES
('root',           'Super Administrador',  '{"all": true}'),
('administrador',  'Administrador',        '{"cursos": true, "empresas": true, "usuarios": true}'),
('instructor',     'Instructor',           '{"cursos_propios": true}'),
('empresa',        'Usuario Empresa',      '{"empleados_propios": true}'),
('consulta',       'Solo Consulta',        '{"lectura": true}'),
('doctor',         'Doctor',               '{"lectura": true}'),
('proteccion_civil','Protección Civil',    '{"proteccion_civil": true}'),
('sgc',             'Sistema de Gestión de Calidad', '{"sgc": true}'),
('ambiental',       'Ambiental',                     '{"ambiental": true}'),
('iot',             'IoT / Sensores',                '{"iot": true}'),
('innovacion',      'Diseño e Innovación',           '{"innovacion": true}'),
('rrhh',            'Recursos Humanos',              '{"rrhh": true}'),
('control_documental', 'Control Documental',         '{"capacitacion": true, "documentos": true}'),
('mantenimiento',   'Mantenimiento',                 '{"mantenimiento": true}');

-- ─────────────────────────────────────────────────────
-- 2. SECTORES EMPRESARIALES
-- ─────────────────────────────────────────────────────
INSERT INTO sector_empresarial (nombre_sector) VALUES
('Industrial'),
('Comercial'),
('Servicios'),
('Construccion'),
('Manufactura'),
('Logistica y Transporte'),
('Alimenticio'),
('Tecnologia'),
('Salud'),
('Educacion'),
('Gobierno'),
('Otro');

-- ─────────────────────────────────────────────────────
-- 3. AREAS TEMATICAS
-- ─────────────────────────────────────────────────────
INSERT INTO area_tematica (nombre_area, icono, color, slug, orden) VALUES
('Seguridad',                          'fa-shield-alt',      '#38512F', 'seguridad',            1),
('Higiene y Seguridad en el Trabajo',  'fas fa-stethoscope', '#007C92', 'higiene-seguridad',    2),
('Salud y Bienestar',                  'fa-heartbeat',       '#E74C3C', 'salud',                3),
('Medio Ambiente',                     'fa-leaf',            '#27AE60', 'ambientales',          4),
('Productividad y Gerenciales',        'fa-chart-line',      '#F39C12', 'productividad',        5),
('Conduccion de Vehiculos',            'fa-car',             '#34495E', 'conduccion-vehiculos', 6),
('Areas Diversas',                     'fa-shapes',          '#8E44AD', 'areas-diversas',       7),
('Cursos especiales',                  'fa-atom',            '#0F4C81', 'cursos-especiales',    8);

-- ─────────────────────────────────────────────────────
-- 4. CONFIGURACION DEL SISTEMA
-- ─────────────────────────────────────────────────────
INSERT INTO configuracion (clave, valor, tipo, descripcion) VALUES
('nombre_sistema',      'Biznaga R&T - Sistema de Capacitacion', 'string', 'Nombre del sistema'),
('version',             '1.0.0',                                 'string', 'Version del sistema'),
('email_contacto',      'contacto@biznaga.com.mx',               'string', 'Email de contacto'),
('horas_default_curso', '8',                                     'number', 'Horas por defecto de un curso'),
('cupo_default_curso',  '25',                                    'number', 'Cupo maximo por defecto');

-- ─────────────────────────────────────────────────────
-- 5. USUARIO ROOT (Super Administrador)
--    Username: root
--    Password: BizRoot2026!
--    CAMBIAR PASSWORD INMEDIATAMENTE EN PRODUCCION
-- ─────────────────────────────────────────────────────
INSERT INTO usuario (username, email, clave, nombre, apellido, rol_id, es_responsable_calidad, activo)
VALUES (
  'root',
  'admin@biznaga.com.mx',
  '$2b$12$Zibvoj2u8J0P9.lfcb0XTO3CPRarFhGDrbhTovau0GoiVk3zx0/Ou',
  'Administrador',
  'Root',
  (SELECT rol_id FROM roles WHERE nombre_rol = 'root'),
  0,
  1
);

-- ─────────────────────────────────────────────────────
-- 6. USUARIO RESPONSABLE DE CALIDAD
--    Username: calidad
--    Password: BizCalidad2026!
--    CAMBIAR PASSWORD, NOMBRE Y DATOS INMEDIATAMENTE
--    Este usuario firma las constancias de capacitacion.
--    Actualizar nombre, apellido, email y subir firma
--    desde el panel de administracion.
-- ─────────────────────────────────────────────────────
INSERT INTO usuario (username, email, clave, nombre, apellido, rol_id, es_responsable_calidad, activo)
VALUES (
  'calidad',
  'calidad@biznaga.com.mx',
  '$2b$12$eES6/AjJxqILCAOJqV0NGuS7sy2XfivfItvM3HC2T51DS74UQNvsG',
  'Responsable',
  'Calidad',
  (SELECT rol_id FROM roles WHERE nombre_rol = 'administrador'),
  1,
  1
);

-- ─────────────────────────────────────────────────────
-- 7. VISTAS SQL
-- Estas vistas son CRITICAS. El sistema las usa en
-- multiples endpoints. Sin ellas, el backend da error 500.
-- ─────────────────────────────────────────────────────

-- Vista: Cursos con su area tematica
CREATE OR REPLACE VIEW v_cursos_completo AS
SELECT
    c.curso_id, c.nombre_curso, c.descripcion, c.area_id,
    c.horas, c.precio, c.cupo_maximo, c.cupo_minimo,
    c.requisitos, c.temario, c.material_incluido,
    c.modalidad_default, c.certificacion, c.vigencia_certificado,
    c.activo, c.created_at, c.updated_at,
    a.nombre_area, a.slug AS area_slug
FROM curso c
LEFT JOIN area_tematica a ON c.area_id = a.area_id;

-- Vista: Cursos programados con datos de curso, empresa e instructor
CREATE OR REPLACE VIEW v_cursos_programados AS
SELECT
    cp.programado_id, cp.curso_id, cp.empresa_id, cp.instructor_id,
    cp.fecha_inicio, cp.fecha_fin, cp.hora_inicio, cp.hora_fin,
    cp.modalidad, cp.ubicacion, cp.estado, cp.ciudad, cp.localidad,
    cp.cupo, cp.estatus, cp.notas, cp.created_by, cp.created_at,
    c.nombre_curso, c.descripcion AS curso_descripcion, c.horas AS curso_horas,
    e.nombre_empresa, e.rfc AS empresa_rfc,
    CONCAT_WS(' ', i.nombre, i.apellido_paterno, i.apellido_materno) AS instructor_nombre,
    i.apellido_paterno AS instructor_apellido_paterno,
    i.apellido_materno AS instructor_apellido_materno,
    i.email AS instructor_email, i.telefono AS instructor_telefono
FROM curso_programado cp
JOIN curso c ON cp.curso_id = c.curso_id
JOIN empresa e ON cp.empresa_id = e.empresa_id
LEFT JOIN instructor i ON cp.instructor_id = i.instructor_id
ORDER BY cp.fecha_inicio DESC;

-- Vista: Documentos de curso con nombre de curso y area
CREATE OR REPLACE VIEW v_documentos_curso AS
SELECT
    dc.documento_id, dc.curso_id,
    c.nombre_curso, a.nombre_area,
    dc.nombre AS documento_nombre, dc.descripcion,
    dc.tipo_aceptado, dc.archivo_nombre, dc.archivo_url,
    dc.fecha_subida, dc.tamano, dc.activo,
    dc.fecha_creacion, dc.fecha_actualizacion,
    CASE WHEN dc.archivo_nombre IS NOT NULL THEN 'Subido' ELSE 'Pendiente' END AS estado
FROM documento_curso dc
JOIN curso c ON dc.curso_id = c.curso_id
JOIN area_tematica a ON c.area_id = a.area_id
WHERE dc.activo = 1 AND c.activo = 1;

-- Vista: Empleados con nombre de empresa
CREATE OR REPLACE VIEW v_empleados_empresa AS
SELECT
    e.empleado_id, e.empresa_id, e.numero_empleado,
    e.nombre, e.apellido_paterno, e.apellido_materno,
    e.curp, e.rfc_empleado, e.nss,
    e.fecha_nacimiento, e.genero, e.email, e.telefono,
    e.puesto, e.departamento, e.fecha_ingreso,
    e.activo, e.created_at, e.updated_at,
    emp.nombre_empresa, emp.rfc AS empresa_rfc
FROM empleado e
JOIN empresa emp ON e.empresa_id = emp.empresa_id;

-- Vista: Estadisticas para el dashboard
CREATE OR REPLACE VIEW v_estadisticas_dashboard AS
SELECT
    (SELECT COUNT(*) FROM empresa WHERE activo = 1) AS total_empresas,
    (SELECT COUNT(*) FROM curso WHERE activo = 1) AS total_cursos,
    (SELECT COUNT(*) FROM instructor WHERE activo = 1) AS total_instructores,
    (SELECT COUNT(*) FROM historial_cursos WHERE fecha_inicio >= CURDATE() - INTERVAL 30 DAY) AS cursos_ultimo_mes,
    (SELECT COALESCE(SUM(total_participantes), 0) FROM historial_cursos WHERE fecha_inicio >= CURDATE() - INTERVAL 30 DAY) AS personas_capacitadas_mes,
    (SELECT COUNT(*) FROM curso_programado WHERE fecha_inicio BETWEEN CURDATE() AND CURDATE() + INTERVAL 30 DAY) AS cursos_proximos_30_dias;

-- ─────────────────────────────────────────────────────
-- 8. STORED PROCEDURES
-- ─────────────────────────────────────────────────────

-- Procedure: Estadisticas generales de cursos
DROP PROCEDURE IF EXISTS sp_estadisticas_cursos;
DELIMITER //
CREATE PROCEDURE sp_estadisticas_cursos()
BEGIN
    SELECT
        COUNT(*) AS total_cursos,
        SUM(CASE WHEN activo = TRUE THEN 1 ELSE 0 END) AS cursos_activos,
        (SELECT COUNT(*) FROM curso_programado WHERE estatus = 'programado') AS programados,
        (SELECT COUNT(*) FROM historial_cursos
         WHERE MONTH(fecha_inicio) = MONTH(CURRENT_DATE)
           AND YEAR(fecha_inicio) = YEAR(CURRENT_DATE)) AS cursos_mes
    FROM curso;
END //
DELIMITER ;

-- Procedure: Historial de cursos de un empleado
DROP PROCEDURE IF EXISTS sp_historial_empleado;
DELIMITER //
CREATE PROCEDURE sp_historial_empleado(IN p_empleado_id INT)
BEGIN
    SELECT
        c.nombre_curso, h.fecha_inicio, h.fecha_fin,
        ic.calificacion, ic.aprobado, ic.certificado_url,
        CONCAT(i.nombre, ' ', i.apellido_paterno) AS instructor
    FROM inscripcion_curso ic
    JOIN curso_programado cp ON ic.programado_id = cp.programado_id
    JOIN curso c ON cp.curso_id = c.curso_id
    LEFT JOIN historial_cursos h ON cp.programado_id = h.programado_id
    LEFT JOIN instructor i ON cp.instructor_id = i.instructor_id
    WHERE ic.empleado_id = p_empleado_id
    ORDER BY h.fecha_inicio DESC;
END //
DELIMITER ;

-- =====================================================
-- VERIFICACION POST-SEED
-- Ejecuta estas queries para confirmar que todo esta bien:
--
--   SELECT nombre_rol FROM roles;
--   -- Debe mostrar: root, administrador, instructor, empresa, consulta, doctor
--
--   SELECT username, nombre, apellido, r.nombre_rol, es_responsable_calidad
--   FROM usuario u JOIN roles r ON u.rol_id = r.rol_id;
--   -- Debe mostrar 2 usuarios: root (root) y calidad (administrador, resp. calidad)
--
--   SELECT COUNT(*) FROM sector_empresarial;
--   -- Debe mostrar: 12
--
--   SELECT COUNT(*) FROM area_tematica;
--   -- Debe mostrar: 7
--
--   SELECT COUNT(*) FROM configuracion;
--   -- Debe mostrar: 5
--
--   SHOW FULL TABLES WHERE Table_type = 'VIEW';
--   -- Debe mostrar 5 vistas:
--   --   v_cursos_completo, v_cursos_programados, v_documentos_curso,
--   --   v_empleados_empresa, v_estadisticas_dashboard
--
--   SHOW PROCEDURE STATUS WHERE Db = 'biznaga';
--   -- Debe mostrar 2 procedures:
--   --   sp_estadisticas_cursos, sp_historial_empleado
-- =====================================================
