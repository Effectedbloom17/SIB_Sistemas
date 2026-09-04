// =====================================================
// Adjuntos grandes de correo — paquete con token 256-bit,
// página Biznaga, auditoría, ZIP, rate-limit y limpieza.
// =====================================================

const fs = require('fs');
const fsp = require('fs').promises;
const path = require('path');
const crypto = require('crypto');
const AdmZip = require('adm-zip');

const STORAGE_DIR = path.join(__dirname, 'storage', 'correo-adjuntos');
const TTL_DIAS = Math.max(1, Number(process.env.CORREO_ADJUNTOS_TTL_DIAS || 30));

function resolverPublicBaseUrl() {
    // Debe ser el host del API (donde vive Express), NO el frontend Angular.
    // Producción: https://api.sistema.biznaga.com.mx
    // Frontend:   https://sistema.biznaga.com.mx  ← si se usa este, el SPA captura la ruta y manda al dashboard.
    let fromEnv = String(process.env.PUBLIC_API_URL || '').trim().replace(/\/+$/, '');

    // Corrección automática del error más común: apuntar al frontend en vez del API.
    if (/^https?:\/\/sistema\.biznaga\.com\.mx$/i.test(fromEnv)) {
        console.warn(
            '[CORREO-ADJUNTOS] PUBLIC_API_URL apuntaba al frontend; se corrige a https://api.sistema.biznaga.com.mx'
        );
        fromEnv = 'https://api.sistema.biznaga.com.mx';
    }

    if (fromEnv) {
        return fromEnv;
    }
    // En desarrollo los archivos viven en este mismo API.
    if (String(process.env.NODE_ENV || '').toLowerCase() !== 'production') {
        const port = process.env.PORT || 3100;
        return `http://localhost:${port}`;
    }
    return 'https://api.sistema.biznaga.com.mx';
}

const PUBLIC_BASE_URL = resolverPublicBaseUrl();
const RATE_LIMIT_MAX = Math.max(5, Number(process.env.CORREO_DESCARGAS_RATE_MAX || 20));
const RATE_LIMIT_WINDOW_MS = Math.max(10_000, Number(process.env.CORREO_DESCARGAS_RATE_WINDOW_MS || 60_000));

function esUrlPublicaLocal() {
    return /localhost|127\.0\.0\.1/i.test(PUBLIC_BASE_URL);
}

let limpiezaEnCurso = null;
let cronLimpiezaTimer = null;

function asegurarDirectorioBase() {
    if (!fs.existsSync(STORAGE_DIR)) {
        fs.mkdirSync(STORAGE_DIR, { recursive: true });
    }
}

function esTokenValido(token) {
    return /^[a-f0-9]{64}$/i.test(String(token || '').trim());
}

function esFileIdValido(fileId) {
    return /^[a-f0-9]{16}$/i.test(String(fileId || '').trim());
}

function construirUrlPaquete(token) {
    return `${PUBLIC_BASE_URL}/api/correo-descargas/${encodeURIComponent(token)}`;
}

function construirUrlArchivo(token, fileId) {
    return `${PUBLIC_BASE_URL}/api/correo-descargas/${encodeURIComponent(token)}/archivo/${encodeURIComponent(fileId)}`;
}

function construirUrlZip(token) {
    return `${PUBLIC_BASE_URL}/api/correo-descargas/${encodeURIComponent(token)}/zip`;
}

function formatearTamanoHumano(bytes) {
    const n = Number(bytes) || 0;
    if (n < 1024) return `${n} B`;
    if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
    return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

function formatearFechaLargaEs(iso) {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '';
    return d.toLocaleDateString('es-MX', {
        day: 'numeric',
        month: 'long',
        year: 'numeric',
        timeZone: 'America/Mexico_City'
    });
}

function formatearFechaHoraCortaEs(iso) {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '';
    return d.toLocaleString('es-MX', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        timeZone: 'America/Mexico_City'
    });
}

function contentDispositionAttachment(nombreOriginal = 'archivo') {
    const nombre = path.basename(String(nombreOriginal || 'archivo')).replace(/["\r\n]/g, '') || 'archivo';
    const ascii = nombre.replace(/[^\x20-\x7E]/g, '_').replace(/\\/g, '_');
    const encoded = encodeURIComponent(nombre).replace(/['()]/g, (ch) => `%${ch.charCodeAt(0).toString(16).toUpperCase()}`);
    return `attachment; filename="${ascii}"; filename*=UTF-8''${encoded}`;
}

function escaparHtml(texto = '') {
    return String(texto || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function obtenerIpCliente(req) {
    const xf = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
    return xf || req.ip || req.socket?.remoteAddress || '';
}

function rutaPaquete(token) {
    return path.join(STORAGE_DIR, String(token).toLowerCase());
}

function rutaMeta(token) {
    return path.join(rutaPaquete(token), 'meta.json');
}

function rutaArchivoBin(token, fileId) {
    return path.join(rutaPaquete(token), 'files', `${String(fileId).toLowerCase()}.bin`);
}

async function leerMeta(token) {
    try {
        return JSON.parse(await fsp.readFile(rutaMeta(token), 'utf8'));
    } catch {
        return null;
    }
}

async function escribirMeta(token, meta) {
    await fsp.writeFile(rutaMeta(token), JSON.stringify(meta, null, 2), 'utf8');
}

async function eliminarPaquete(token) {
    if (!esTokenValido(token)) return;
    await fsp.rm(rutaPaquete(token), { recursive: true, force: true }).catch(() => {});
}

async function limpiarExpirados() {
    if (limpiezaEnCurso) return limpiezaEnCurso;

    limpiezaEnCurso = (async () => {
        asegurarDirectorioBase();
        let eliminados = 0;
        let entradas = [];
        try {
            entradas = await fsp.readdir(STORAGE_DIR, { withFileTypes: true });
        } catch {
            return 0;
        }

        const ahora = Date.now();
        for (const entrada of entradas) {
            if (!entrada.isDirectory() || !esTokenValido(entrada.name)) continue;
            const meta = await leerMeta(entrada.name);
            const expira = Date.parse(meta?.expiresAt || 0);
            if (!meta || !Number.isFinite(expira) || expira <= ahora) {
                await eliminarPaquete(entrada.name);
                eliminados += 1;
            }
        }

        if (eliminados > 0) {
            console.log(`[CORREO-ADJUNTOS] Limpieza: ${eliminados} paquete(s) expirado(s) eliminado(s)`);
        }
        return eliminados;
    })().finally(() => {
        limpiezaEnCurso = null;
    });

    return limpiezaEnCurso;
}

function msHastaProximaHora(hora = 2, minuto = 0) {
    const ahora = new Date();
    const siguiente = new Date(ahora);
    siguiente.setHours(hora, minuto, 0, 0);
    if (siguiente <= ahora) {
        siguiente.setDate(siguiente.getDate() + 1);
    }
    return siguiente.getTime() - ahora.getTime();
}

function iniciarCronLimpiezaDiaria() {
    if (cronLimpiezaTimer) return;

    const programar = () => {
        const espera = msHastaProximaHora(2, 0);
        cronLimpiezaTimer = setTimeout(async () => {
            try {
                await limpiarExpirados();
            } catch (err) {
                console.warn('[CORREO-ADJUNTOS] Cron limpieza falló:', err?.message || err);
            }
            cronLimpiezaTimer = null;
            programar();
        }, espera);
        if (typeof cronLimpiezaTimer.unref === 'function') {
            cronLimpiezaTimer.unref();
        }
        const startupLog = require('./startupLog');
        startupLog.detail(`[CORREO-ADJUNTOS] Próxima limpieza automática en ${Math.round(espera / 60000)} min (02:00)`);
    };

    programar();
}

/**
 * Guarda uno o más adjuntos grandes como paquete con token 256-bit.
 * @param {Array<{content: Buffer, filename: string, contentType?: string}>} adjuntos
 * @param {{ remitente?: string, destinatarios?: string }} opts
 */
async function guardarPaqueteAdjuntos(adjuntos = [], opts = {}) {
    const lista = Array.isArray(adjuntos) ? adjuntos.filter((a) => Buffer.isBuffer(a?.content) && a.content.length > 0) : [];
    if (lista.length === 0) {
        throw new Error('No hay archivos válidos para guardar');
    }

    asegurarDirectorioBase();
    limpiarExpirados().catch(() => {});

    const token = crypto.randomBytes(32).toString('hex');
    const dir = rutaPaquete(token);
    const filesDir = path.join(dir, 'files');
    await fsp.mkdir(filesDir, { recursive: true });

    const expiresAt = new Date(Date.now() + TTL_DIAS * 24 * 60 * 60 * 1000).toISOString();
    const archivos = [];

    for (const adjunto of lista) {
        const fileId = crypto.randomBytes(8).toString('hex');
        const nombre = path.basename(String(adjunto.filename || 'adjunto'))
            .replace(/["\r\n]/g, '') || 'adjunto';
        const contentType = String(adjunto.contentType || 'application/octet-stream').trim()
            || 'application/octet-stream';

        await fsp.writeFile(rutaArchivoBin(token, fileId), adjunto.content);
        archivos.push({
            id: fileId,
            nombre,
            contentType,
            tamanoBytes: adjunto.content.length
        });
    }

    const meta = {
        token,
        createdAt: new Date().toISOString(),
        expiresAt,
        remitente: opts.remitente || null,
        destinatarios: opts.destinatarios || null,
        archivos,
        descargas: []
    };
    await escribirMeta(token, meta);

    const fechaExpiracionTexto = formatearFechaLargaEs(expiresAt);
    return {
        token,
        url: construirUrlPaquete(token),
        urlZip: archivos.length > 1 ? construirUrlZip(token) : null,
        expiresAt,
        fechaExpiracionTexto,
        ttlDias: TTL_DIAS,
        totalBytes: archivos.reduce((s, a) => s + a.tamanoBytes, 0),
        archivos: archivos.map((a) => ({
            id: a.id,
            nombre: a.nombre,
            contentType: a.contentType,
            tamanoBytes: a.tamanoBytes,
            tamanoTexto: formatearTamanoHumano(a.tamanoBytes),
            url: construirUrlArchivo(token, a.id)
        }))
    };
}

/** Compatibilidad: un solo archivo. */
async function guardarAdjuntoGrande(opts = {}) {
    const paquete = await guardarPaqueteAdjuntos([{
        content: opts.content,
        filename: opts.filename,
        contentType: opts.contentType
    }], { remitente: opts.remitente, destinatarios: opts.destinatarios });

    const archivo = paquete.archivos[0];
    return {
        nombre: archivo.nombre,
        url: paquete.url,
        urlArchivo: archivo.url,
        token: paquete.token,
        fileId: archivo.id,
        tamanoBytes: archivo.tamanoBytes,
        expiresAt: paquete.expiresAt,
        fechaExpiracionTexto: paquete.fechaExpiracionTexto,
        contentType: archivo.contentType,
        paquete
    };
}

/**
 * Resuelve un paquete. No elimina archivos al expirar (eso lo hace el cron).
 * @returns {null | { expired: true, meta?: object } | { meta, vigente: true }}
 */
async function resolverPaquete(tokenRaw) {
    const token = String(tokenRaw || '').trim().toLowerCase();
    if (!esTokenValido(token)) return null;

    const meta = await leerMeta(token);
    if (!meta) return null;

    const expira = Date.parse(meta.expiresAt || 0);
    if (!Number.isFinite(expira) || expira <= Date.now()) {
        return { expired: true, meta };
    }

    const archivos = Array.isArray(meta.archivos) ? meta.archivos : [];
    for (const archivo of archivos) {
        try {
            await fsp.access(rutaArchivoBin(token, archivo.id), fs.constants.R_OK);
        } catch {
            return null;
        }
    }

    return { vigente: true, meta: { ...meta, token } };
}

async function registrarDescarga(token, entrada) {
    const meta = await leerMeta(token);
    if (!meta) return null;

    if (!Array.isArray(meta.descargas)) meta.descargas = [];
    meta.descargas.push({
        at: new Date().toISOString(),
        ip: entrada.ip || null,
        userAgent: String(entrada.userAgent || '').slice(0, 400) || null,
        tipo: entrada.tipo || 'archivo',
        archivoId: entrada.archivoId || null,
        nombre: entrada.nombre || null
    });
    // Limitar bitácora a las últimas 500 entradas
    if (meta.descargas.length > 500) {
        meta.descargas = meta.descargas.slice(-500);
    }
    await escribirMeta(token, meta);
    return meta;
}

function renderPaginaBase({ titulo, cuerpoHtml, statusCode = 200 }) {
    return `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escaparHtml(titulo)} · Biznaga Risk&amp;Tech</title>
  <style>
    :root {
      --ink: #14261f;
      --muted: #5b6b63;
      --line: #d7e0da;
      --panel: #ffffff;
      --bg1: #eef4f0;
      --bg2: #dfeae3;
      --accent: #1f6b4a;
      --accent-dark: #164f37;
      --warn-bg: #fff7ed;
      --warn-border: #fdba74;
      --warn-text: #9a3412;
      --danger-bg: #fef2f2;
      --danger-border: #fecaca;
      --danger-text: #991b1b;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      min-height: 100vh;
      font-family: "Segoe UI", "Century Gothic", Arial, sans-serif;
      color: var(--ink);
      background:
        radial-gradient(1200px 500px at 10% -10%, #cfe3d8 0%, transparent 55%),
        linear-gradient(160deg, var(--bg1), var(--bg2));
    }
    .wrap {
      max-width: 720px;
      margin: 0 auto;
      padding: 40px 20px 56px;
    }
    .brand {
      display: flex;
      align-items: baseline;
      gap: 10px;
      margin-bottom: 22px;
    }
    .brand-mark {
      width: 12px; height: 12px; border-radius: 999px;
      background: var(--accent);
      box-shadow: 0 0 0 6px rgba(31,107,74,.12);
    }
    .brand h1 {
      margin: 0;
      font-size: 1.15rem;
      letter-spacing: .02em;
      font-weight: 700;
    }
    .brand span { color: var(--muted); font-size: .85rem; }
    .card {
      background: var(--panel);
      border: 1px solid var(--line);
      border-radius: 16px;
      padding: 28px 26px;
      box-shadow: 0 18px 40px rgba(20, 38, 31, .08);
    }
    h2 { margin: 0 0 8px; font-size: 1.45rem; line-height: 1.25; }
    .lead { margin: 0 0 20px; color: var(--muted); line-height: 1.5; }
    .alert {
      border-radius: 10px;
      padding: 12px 14px;
      margin: 0 0 20px;
      font-size: .92rem;
      line-height: 1.45;
    }
    .alert-warn { background: var(--warn-bg); border: 1px solid var(--warn-border); color: var(--warn-text); }
    .alert-info { background: #f3faf6; border: 1px solid #d7e0da; color: #345246; }
    .alert-danger { background: var(--danger-bg); border: 1px solid var(--danger-border); color: var(--danger-text); }
    .meta-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
      gap: 12px;
      margin: 0 0 22px;
    }
    .meta-item {
      background: #f5f8f6;
      border: 1px solid var(--line);
      border-radius: 10px;
      padding: 12px 14px;
    }
    .meta-item label {
      display: block;
      font-size: .72rem;
      text-transform: uppercase;
      letter-spacing: .06em;
      color: var(--muted);
      margin-bottom: 4px;
    }
    .meta-item strong { font-size: .95rem; }
    .file-list { display: flex; flex-direction: column; gap: 10px; margin: 0 0 18px; }
    .file-row {
      display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between;
      gap: 10px; padding: 12px 14px; border: 1px solid var(--line); border-radius: 12px;
      background: #fbfcfb;
    }
    .file-name { font-weight: 650; }
    .file-size { color: var(--muted); font-size: .9rem; margin-left: 8px; }
    .btn {
      display: inline-flex; align-items: center; justify-content: center; gap: 8px;
      padding: 10px 16px; border-radius: 999px; text-decoration: none; font-weight: 650;
      font-size: .92rem; border: 0; cursor: pointer;
    }
    .btn-primary { background: var(--accent); color: #fff; }
    .btn-primary:hover { background: var(--accent-dark); }
    .btn-secondary {
      background: #fff; color: var(--accent-dark);
      border: 1px solid #b7d0c3;
    }
    .actions { display: flex; flex-wrap: wrap; gap: 10px; margin-top: 8px; }
    .foot { margin-top: 18px; color: var(--muted); font-size: .82rem; line-height: 1.45; }
    .audit { margin-top: 16px; color: var(--muted); font-size: .85rem; }
  </style>
</head>
<body>
  <div class="wrap">
    <div class="brand">
      <span class="brand-mark" aria-hidden="true"></span>
      <div>
        <h1>Biznaga Risk&amp;Tech</h1>
        <span>Centro de descarga segura</span>
      </div>
    </div>
    <div class="card">
      ${cuerpoHtml}
    </div>
  </div>
</body>
</html>`;
}

function renderPaginaExpirada(meta = null) {
    const fecha = meta?.expiresAt ? formatearFechaLargaEs(meta.expiresAt) : null;
    const cuerpo = `
      <h2>Este enlace ya expiró</h2>
      <p class="lead">El periodo de disponibilidad de estos documentos ha concluido.</p>
      <div class="alert alert-danger">
        ${fecha
            ? `Los documentos estuvieron disponibles hasta el <strong>${escaparHtml(fecha)}</strong>.`
            : 'El enlace de descarga ya no es válido.'}
        <br>Solicite nuevamente el documento al remitente.
      </div>
      <p class="foot">Si usted es el remitente, vuelva a enviar el correo desde el sistema Biznaga para generar un nuevo enlace.</p>
    `;
    return renderPaginaBase({ titulo: 'Enlace expirado', cuerpoHtml: cuerpo, statusCode: 410 });
}

function renderPaginaNoEncontrada() {
    const cuerpo = `
      <h2>Enlace no válido</h2>
      <p class="lead">No encontramos documentos asociados a este enlace.</p>
      <div class="alert alert-danger">
        El enlace puede estar incompleto, haber sido eliminado o no existir.
        Solicite nuevamente el documento al remitente.
      </div>
    `;
    return renderPaginaBase({ titulo: 'Enlace no válido', cuerpoHtml: cuerpo, statusCode: 404 });
}

function renderPaginaPaquete(meta, token) {
    const fechaTexto = formatearFechaLargaEs(meta.expiresAt);
    const archivos = Array.isArray(meta.archivos) ? meta.archivos : [];
    const totalBytes = archivos.reduce((s, a) => s + (Number(a.tamanoBytes) || 0), 0);
    const descargas = Array.isArray(meta.descargas) ? meta.descargas : [];
    const totalDescargas = descargas.length;
    const zipUrl = archivos.length > 1 ? construirUrlZip(token) : null;

    const filas = archivos.map((a) => {
        const url = construirUrlArchivo(token, a.id);
        return `
          <div class="file-row">
            <div>
              <span class="file-name">${escaparHtml(a.nombre)}</span>
              <span class="file-size">${escaparHtml(formatearTamanoHumano(a.tamanoBytes))}</span>
            </div>
            <a class="btn btn-primary" href="${escaparHtml(url)}">⬇ Descargar</a>
          </div>
        `;
    }).join('');

    const cuerpo = `
      <h2>Documentos listos para descarga</h2>
      <p class="lead">Revise los archivos y descárguelos cuando lo necesite. Puede descargarlos las veces que requiera mientras el enlace esté vigente.</p>
      <div class="alert alert-info">
        <strong>Aviso:</strong> los documentos compartidos mediante este enlace estarán disponibles para descarga hasta el
        <strong>${escaparHtml(fechaTexto)}</strong>.
        Una vez transcurrida esa fecha, los enlaces dejarán de estar disponibles.
      </div>
      <div class="meta-grid">
        <div class="meta-item">
          <label>Disponible hasta</label>
          <strong>${escaparHtml(fechaTexto)}</strong>
        </div>
        <div class="meta-item">
          <label>Archivos</label>
          <strong>${archivos.length}</strong>
        </div>
        <div class="meta-item">
          <label>Tamaño total</label>
          <strong>${escaparHtml(formatearTamanoHumano(totalBytes))}</strong>
        </div>
      </div>
      ${zipUrl ? `
        <div class="actions" style="margin-bottom:16px;">
          <a class="btn btn-primary" href="${escaparHtml(zipUrl)}">⬇ Descargar todo (.zip)</a>
        </div>
        <p class="lead" style="margin-top:-8px;font-size:.9rem;">o descargar individualmente:</p>
      ` : ''}
      <div class="file-list">${filas}</div>
      <p class="audit">Este documento ${totalDescargas === 1
          ? 'ya fue descargado 1 vez'
          : totalDescargas > 1
            ? `ya fue descargado ${totalDescargas} veces`
            : 'aún no ha sido descargado'}.</p>
      <p class="foot">Biznaga Risk&amp;Tech · Descarga segura sin cuenta de Google ni contraseña.</p>
    `;
    return renderPaginaBase({ titulo: 'Descarga de documentos', cuerpoHtml: cuerpo });
}

async function servirPaginaPaquete(req, res, token) {
    const resultado = await resolverPaquete(token);

    if (!resultado) {
        res.status(404).setHeader('Content-Type', 'text/html; charset=utf-8');
        return res.send(renderPaginaNoEncontrada());
    }

    if (resultado.expired) {
        res.status(410).setHeader('Content-Type', 'text/html; charset=utf-8');
        return res.send(renderPaginaExpirada(resultado.meta));
    }

    res.status(200).setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Cache-Control', 'private, no-store');
    return res.send(renderPaginaPaquete(resultado.meta, resultado.meta.token));
}

async function pipeArchivo(res, filePath, { contentType, nombre, tamanoBytes }) {
    res.setHeader('Content-Type', contentType || 'application/octet-stream');
    res.setHeader('Content-Disposition', contentDispositionAttachment(nombre));
    res.setHeader('Cache-Control', 'private, no-store, no-cache, must-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    if (tamanoBytes) {
        res.setHeader('Content-Length', String(tamanoBytes));
    }

    return new Promise((resolve) => {
        const stream = fs.createReadStream(filePath);
        stream.on('error', (err) => {
            console.error('[CORREO-ADJUNTOS] Error leyendo archivo:', err.message);
            if (!res.headersSent) {
                res.status(500).json({ success: false, message: 'No se pudo leer el archivo' });
            } else {
                res.destroy(err);
            }
            resolve();
        });
        stream.on('end', () => resolve());
        stream.pipe(res);
    });
}

async function servirArchivo(req, res, tokenRaw, fileIdRaw) {
    const resultado = await resolverPaquete(tokenRaw);

    if (!resultado) {
        res.status(404).setHeader('Content-Type', 'text/html; charset=utf-8');
        return res.send(renderPaginaNoEncontrada());
    }
    if (resultado.expired) {
        res.status(410).setHeader('Content-Type', 'text/html; charset=utf-8');
        return res.send(renderPaginaExpirada(resultado.meta));
    }

    const fileId = String(fileIdRaw || '').trim().toLowerCase();
    if (!esFileIdValido(fileId)) {
        return res.status(400).json({ success: false, message: 'Identificador de archivo inválido' });
    }

    const archivo = (resultado.meta.archivos || []).find((a) => String(a.id).toLowerCase() === fileId);
    if (!archivo) {
        res.status(404).setHeader('Content-Type', 'text/html; charset=utf-8');
        return res.send(renderPaginaNoEncontrada());
    }

    const filePath = rutaArchivoBin(resultado.meta.token, fileId);
    try {
        await fsp.access(filePath, fs.constants.R_OK);
    } catch {
        res.status(404).setHeader('Content-Type', 'text/html; charset=utf-8');
        return res.send(renderPaginaNoEncontrada());
    }

    await registrarDescarga(resultado.meta.token, {
        ip: obtenerIpCliente(req),
        userAgent: req.headers['user-agent'],
        tipo: 'archivo',
        archivoId: fileId,
        nombre: archivo.nombre
    });

    return pipeArchivo(res, filePath, {
        contentType: archivo.contentType,
        nombre: archivo.nombre,
        tamanoBytes: archivo.tamanoBytes
    });
}

async function servirZip(req, res, tokenRaw) {
    const resultado = await resolverPaquete(tokenRaw);

    if (!resultado) {
        res.status(404).setHeader('Content-Type', 'text/html; charset=utf-8');
        return res.send(renderPaginaNoEncontrada());
    }
    if (resultado.expired) {
        res.status(410).setHeader('Content-Type', 'text/html; charset=utf-8');
        return res.send(renderPaginaExpirada(resultado.meta));
    }

    const archivos = resultado.meta.archivos || [];
    if (archivos.length === 0) {
        return res.status(404).json({ success: false, message: 'No hay archivos en el paquete' });
    }

    const zip = new AdmZip();
    const usados = new Map();
    for (const archivo of archivos) {
        const binPath = rutaArchivoBin(resultado.meta.token, archivo.id);
        let nombreZip = archivo.nombre || 'archivo';
        const base = nombreZip;
        let n = usados.get(base) || 0;
        if (n > 0) {
            const ext = path.extname(base);
            const stem = path.basename(base, ext);
            nombreZip = `${stem} (${n})${ext}`;
        }
        usados.set(base, n + 1);
        zip.addLocalFile(binPath, '', nombreZip);
    }

    const buffer = zip.toBuffer();
    const nombreZip = `documentos-biznaga-${resultado.meta.token.slice(0, 8)}.zip`;

    await registrarDescarga(resultado.meta.token, {
        ip: obtenerIpCliente(req),
        userAgent: req.headers['user-agent'],
        tipo: 'zip',
        archivoId: null,
        nombre: nombreZip
    });

    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', contentDispositionAttachment(nombreZip));
    res.setHeader('Content-Length', String(buffer.length));
    res.setHeader('Cache-Control', 'private, no-store');
    return res.send(buffer);
}

/** @deprecated use servirPaginaPaquete / servirArchivo */
async function servirDescarga(req, res, token) {
    return servirPaginaPaquete(req, res, token);
}

module.exports = {
    STORAGE_DIR,
    TTL_DIAS,
    PUBLIC_BASE_URL,
    RATE_LIMIT_MAX,
    RATE_LIMIT_WINDOW_MS,
    esUrlPublicaLocal,
    guardarPaqueteAdjuntos,
    guardarAdjuntoGrande,
    resolverPaquete,
    servirPaginaPaquete,
    servirArchivo,
    servirZip,
    servirDescarga,
    limpiarExpirados,
    iniciarCronLimpiezaDiaria,
    contentDispositionAttachment,
    construirUrlPaquete,
    construirUrlArchivo,
    construirUrlZip,
    formatearFechaLargaEs,
    formatearFechaHoraCortaEs,
    formatearTamanoHumano
};
