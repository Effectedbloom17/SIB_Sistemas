-- Limpieza entorno local de pruebas (NO afecta produccion)
-- Conserva usuarios: root (super admin), calidad, hector191123

SET FOREIGN_KEY_CHECKS = 0;

-- ===== biznaga =====
USE biznaga;
DELETE FROM notificacion_usuario;
DELETE FROM tickets;
DELETE FROM log_actividad;
DELETE FROM notificaciones;
DELETE FROM usuario_areas;
DELETE FROM sgc_editores_delegados;
DELETE FROM documento_curso_programado;
DELETE FROM inscripcion_curso;
DELETE FROM historial_cursos;
DELETE FROM curso_programado;
DELETE FROM empleado;
DELETE FROM instructor_areas;
DELETE FROM instructor WHERE instructor_id <> 4;
DELETE FROM empresa;
DELETE FROM usuario WHERE id NOT IN (1, 2, 66);

UPDATE usuario
SET nombre = 'Ing. Sergio Luis Guzmán Vigueras',
    empresa_id = NULL,
    instructor_id = 4
WHERE username = 'calidad';

UPDATE usuario
SET nombre = 'Ing. Hector Ejemplo',
    empresa_id = NULL,
    instructor_id = NULL
WHERE username = 'hector191123';

UPDATE instructor
SET usuario_id = 2,
    nombre = 'Ing. Sergio Luis Guzmán Vigueras'
WHERE instructor_id = 4;

-- ===== biznaga_sgc (datos ligados a empresas) =====
USE biznaga_sgc;
DELETE FROM ambiental_control_oficios;
DELETE FROM ambiental_control_tramites;
DELETE FROM ambiental_spf28_empresa;
DELETE FROM pc_control_resolutivos;
DELETE FROM sgc_control_proyectos;
DELETE FROM sgc_evaluacion_proveedor;
DELETE FROM sgc_queja_cliente;
DELETE FROM sgc_formato_datos;
DELETE FROM sgc_documentacion_extra;

-- ===== medicos_biznaga =====
USE medicos_biznaga;
DELETE FROM antecedente_laboral;
DELETE FROM diagnostico;
DELETE FROM historia_clinica;

-- ===== proteccion_civil =====
USE proteccion_civil;
DELETE FROM documento_proteccion_civil_archivo;
DELETE FROM historial_documentos_pc;
DELETE FROM historial_textos_pc;
DELETE FROM documento_proteccion_civil;
DELETE FROM pc_documentacion_extra;
DELETE FROM pc_centro_operaciones;

SET FOREIGN_KEY_CHECKS = 1;
