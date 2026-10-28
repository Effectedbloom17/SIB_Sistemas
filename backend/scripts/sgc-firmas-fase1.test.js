/**
 * Comprueba la lógica de huella, estados y zonas sin base de datos.
 * Ejecutar: node backend/scripts/sgc-firmas-fase1.test.js
 */
const assert = require('assert');
const firmas = require('../sgcFirmasService');

const base = {
    codigo: 'SGC-PO-01',
    registro: 'SGC-PO-01',
    version: '01',
    versionSistema: '',
    driveFileId: '1lTfkG06cJxVKx4oQWtwXkCojVGnDByNZ',
    resumen: 'Política vigente autorizada en octubre.'
};

const huellaA = firmas.huellaVersion(base);
const huellaB = firmas.huellaVersion(base);
assert.strictEqual(huellaA, huellaB, 'la misma versión produce la misma huella');
assert.strictEqual(huellaA.length, 64);

const huellaC = firmas.huellaVersion({ ...base, version: '02' });
assert.notStrictEqual(huellaA, huellaC, 'otra versión no reutiliza la huella');

const huellaD = firmas.huellaVersion({ ...base, resumen: 'Texto distinto de la política.' });
assert.notStrictEqual(huellaA, huellaD, 'otro resumen no reutiliza la huella');

assert.strictEqual(
    firmas.estadoSolicitudDesdeFirmantes([{ estado: 'pendiente' }, { estado: 'pendiente' }]),
    'pendiente'
);
assert.strictEqual(
    firmas.estadoSolicitudDesdeFirmantes([{ estado: 'aprobada' }, { estado: 'pendiente' }]),
    'parcial'
);
assert.strictEqual(
    firmas.estadoSolicitudDesdeFirmantes([{ estado: 'aprobada' }, { estado: 'aprobada' }]),
    'autorizada'
);
assert.strictEqual(
    firmas.estadoSolicitudDesdeFirmantes([{ estado: 'aprobada' }, { estado: 'rechazada' }]),
    'rechazada'
);
assert.strictEqual(
    firmas.estadoSolicitudDesdeFirmantes([{ estado: 'aprobada' }], 'invalidada'),
    'invalidada'
);

const zonas = [
    { zona_id: 7, etiqueta: 'Firmante', activo: true, confianza: 'identificado', firmas_requeridas: 1 },
    { zona_id: 8, etiqueta: 'Elaboró', activo: true, confianza: 'pendiente', firmas_requeridas: 1 }
];
assert.deepStrictEqual(
    firmas.validarAsignacion(zonas, [{ usuarioId: 4, zonaId: 7 }]),
    []
);
const falta = firmas.validarAsignacion(zonas, [{ usuarioId: 4, zonaId: 0 }]);
assert.ok(falta.some((m) => m.includes('Firmante')), 'la zona identificada exige firmante');
const repetido = firmas.validarAsignacion(zonas, [
    { usuarioId: 4, zonaId: 7 },
    { usuarioId: 4, zonaId: 7 }
]);
assert.ok(repetido.some((m) => m.includes('repetido')));

assert.strictEqual(firmas.sanitizarRutaDocumento('/sistema-gestion-calidad/capitulo-5/plantilla/sgc-po-01'), '/sistema-gestion-calidad/capitulo-5/plantilla/sgc-po-01');
assert.strictEqual(firmas.sanitizarRutaDocumento('https://evil.example/robo'), '');
assert.strictEqual(firmas.sanitizarRutaDocumento('/dashboard'), '');

assert.ok(firmas.ZONAS_SEMILLA.every((z) => !z.pagina && !z.posX), 'la semilla no inventa coordenadas');
assert.ok(firmas.ZONAS_SEMILLA.some((z) => z.confianza === 'pendiente'));
assert.ok(firmas.ZONAS_SEMILLA.some((z) => z.confianza === 'identificado'));

console.log('sgc-firmas-fase1: ok');
