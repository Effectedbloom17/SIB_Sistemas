/**
 * Seed residentes 2026 (desarrollo) desde hojas Excel compartidas por el usuario.
 * Uso: node scripts/seed-rrhh-residentes-2026.js
 *
 * No borra registros existentes: si ya hay uno activo con el mismo nombre, lo actualiza.
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env'), quiet: true });
const mysql = require('mysql2/promise');
const net = require('net');
const { buildMysqlPoolOptions } = require('../dbPoolUtils');
const rrhh = require('../rrhhResidentesService');

const RESIDENTES = [
  {
    anio: 2026,
    nombre: 'Kyara Gutiérrez Trejo',
    edad: 20,
    estancia: '4 Meses',
    escuela_procedencia: 'Universidad Politecnica de Francisco I. Madero',
    carrera: 'INGENIERIA EN DISEÑO INDUSTRIAL',
    fecha_ingreso: '11-may-26',
    fecha_terminacion: '21 DE AGOSTO 2026',
    nombre_proyecto: 'Diseño de interior',
    supervision_a_cargo: 'Ing. Leonel Pérez',
    telefono: '7711406070',
    correo_personal: '2401160048@upfim.edu.mx',
    correo_institucional: '',
    matricula: '2401160048',
    asesor_academico: 'Carlos Mejia Najera',
    correo_asesor: 'cmejia@upfim.edu.mx',
    tutor_nombre: 'Yaquelin Trejo Calderón',
    tutor_telefono: '7531096846',
    direccion: 'Progreso Centro',
    nss: '38240522219'
  },
  {
    anio: 2026,
    nombre: 'Adrián Gálvez Tejeda',
    edad: 20,
    estancia: '6 meses',
    escuela_procedencia: 'Instituto Tecnológico Superior del Occidente del Estado de Hidalgo',
    carrera: 'Ingeniería Industrial',
    fecha_ingreso: '29 de Junio 2026',
    fecha_terminacion: '30 de Noviembre 2026',
    // Texto truncado en la captura; se puede completar después al editar.
    nombre_proyecto: 'Seguimiento a la Implementación a un Programa de',
    supervision_a_cargo: 'Ing. Leonel Pérez',
    telefono: '7721407993',
    correo_personal: 'arlekin134gate@gmail.com',
    correo_institucional: 'Adrian_seguridad@biznaga.com.mx',
    matricula: '22011162',
    asesor_academico: 'Lilia Antonia Mendoza Sierra',
    correo_asesor: 'lamendoza@itsoeh.edu.mx',
    tutor_nombre: 'Padre Alejandro Mera Medina',
    tutor_telefono: '7721061470',
    direccion: '42186 Paseo de Chavarria Av. Argos Paseo de la Ninfa 1121',
    nss: '38190396697'
  },
  {
    anio: 2026,
    nombre: 'Ana Maria Mata Luna',
    edad: 19,
    estancia: '4 meses',
    escuela_procedencia: 'UT Tulancingo',
    carrera: 'Mecatronica',
    fecha_ingreso: '11-may-26',
    fecha_terminacion: '21-ago-26',
    nombre_proyecto: 'Sistema de detección de gas',
    supervision_a_cargo: 'Ing. Leonel Pérez',
    telefono: '7761238271',
    correo_personal: 'matalunanavaria@gmail.com',
    correo_institucional: '',
    matricula: '1724110799',
    asesor_academico: 'Marcos Antonio Hernández de Ita',
    correo_asesor: '',
    tutor_nombre: 'Ana Luisa Luna Cruz',
    tutor_telefono: '77641025229',
    direccion: 'Guachinango Puebla',
    nss: '16160662827'
  },
  {
    anio: 2026,
    nombre: 'Mariana Hernandez De La Cruz',
    edad: 23,
    estancia: '6 MESES',
    escuela_procedencia: 'Instituto Tecnologico de Pachuca',
    carrera: 'Ingenieria en gestión empresarial',
    fecha_ingreso: '13 de Julio del 2026',
    fecha_terminacion: 'noviembre-diciembre 2026',
    nombre_proyecto: '',
    supervision_a_cargo: 'Ing. Leonel Pérez',
    telefono: '7714672910',
    correo_personal: 'mardelacruz058@gmail.com',
    correo_institucional: 'mariana_administracin@biznaga.com.mx',
    matricula: '22200156',
    asesor_academico: '',
    correo_asesor: '',
    tutor_nombre: 'Rosa Maria Mendez de la Cruz',
    tutor_telefono: '7714852484',
    direccion: '',
    nss: '18180338834'
  }
];

function puedeConectarLocal(host, port, timeoutMs = 800) {
  return new Promise((resolve) => {
    if (!host) return resolve(false);
    const socket = new net.Socket();
    const done = (ok) => {
      try { socket.destroy(); } catch (_) { /* */ }
      resolve(ok);
    };
    socket.setTimeout(timeoutMs);
    socket.once('connect', () => done(true));
    socket.once('timeout', () => done(false));
    socket.once('error', () => done(false));
    socket.connect(Number(port) || 3306, host);
  });
}

(async () => {
  const localHost = process.env.DB_HOST_LOCAL;
  const remoteHost = process.env.DB_HOST_REMOTE;
  const port = Number(process.env.DB_PORT || 3306);
  const isLocal = await puedeConectarLocal(localHost, port);
  const host = isLocal ? localHost : remoteHost;

  console.log(`Conectando a ${host}:${port} (${isLocal ? 'local/desarrollo' : 'remoto'})…`);

  const pool = mysql.createPool(buildMysqlPoolOptions({
    host,
    port,
    user: process.env.DB_USER,
    password: process.env.DB_PASS,
    database: process.env.DB_NAME,
    connectionLimit: 2
  }));

  try {
    await rrhh.asegurarTabla(pool);
    const resultados = [];

    for (const datos of RESIDENTES) {
      const [rows] = await pool.query(
        `SELECT id FROM RRHH_residentes
         WHERE activo = 1 AND UPPER(TRIM(nombre)) = UPPER(TRIM(?))
         LIMIT 1`,
        [datos.nombre]
      );

      let residente;
      let accion;
      if (rows?.length) {
        residente = await rrhh.actualizar(pool, rows[0].id, datos, 'seed-rrhh-2026');
        accion = 'actualizado';
      } else {
        residente = await rrhh.crear(pool, datos, 'seed-rrhh-2026');
        accion = 'creado';
      }

      resultados.push({
        accion,
        id: residente.id,
        nombre: residente.nombre,
        matricula: residente.matricula,
        drive_sheet_title: residente.drive_sheet_title,
        drive_sheet_gid: residente.drive_sheet_gid
      });
      console.log(`✓ ${accion}: ${residente.nombre} (id=${residente.id})`);
    }

    console.log('\nResumen:');
    console.log(JSON.stringify(resultados, null, 2));
  } finally {
    await pool.end();
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
