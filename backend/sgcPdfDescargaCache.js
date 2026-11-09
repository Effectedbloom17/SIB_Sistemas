/**
 * Caché local del PDF ya generado para los formatos Word del SGC.
 * La clave la arma cada formato con el contenido que sí va al documento.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');

const DIR = path.join(os.tmpdir(), 'sib-sgc-pdf');
const memoria = new Map();

function leer(codigo, clave) {
    const hit = memoria.get(codigo);
    if (hit && hit.clave === clave && hit.buffer && hit.buffer.length) {
        return hit.buffer;
    }
    try {
        const archivo = path.join(DIR, `${codigo}-${clave}.pdf`);
        if (!fs.existsSync(archivo)) return null;
        const buffer = fs.readFileSync(archivo);
        if (!buffer.length) return null;
        memoria.set(codigo, { clave, buffer });
        return buffer;
    } catch {
        return null;
    }
}

function guardar(codigo, clave, buffer) {
    if (!buffer || !buffer.length) return;
    memoria.set(codigo, { clave, buffer });
    try {
        fs.mkdirSync(DIR, { recursive: true });
        const nombre = `${codigo}-${clave}.pdf`;
        fs.writeFileSync(path.join(DIR, nombre), buffer);
        for (const item of fs.readdirSync(DIR)) {
            if (item.startsWith(`${codigo}-`) && item.endsWith('.pdf') && item !== nombre) {
                fs.unlinkSync(path.join(DIR, item));
            }
        }
    } catch (err) {
        console.warn(`[${codigo}] No se pudo guardar la caché del PDF:`, err.message);
    }
}

module.exports = { leer, guardar };
