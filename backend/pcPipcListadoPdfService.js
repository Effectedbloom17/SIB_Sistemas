/**
 * Genera PDF del listado maestro PIPC (estilo SP-F-01) con requisitos seleccionados.
 */
const path = require('path');
const fs = require('fs');
const PDFDocument = require('pdfkit');

const COLOR_HEADER = '#1F3864';
const COLOR_GRAY_BG = '#D9D9D9';
const COLOR_BORDER = '#000000';
const COLOR_TEXT = '#111111';

const LOGO_PATHS = [
    path.join(__dirname, '../src/assets/img/logo_biznaga.png'),
    path.join(__dirname, '../public/assets/img/logo_biznaga.png')
];

function sanitizarNombreArchivo(nombre = '') {
    return String(nombre || 'listado-pipc')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-zA-Z0-9._-]+/g, '_')
        .replace(/^_+|_+$/g, '')
        .slice(0, 120) || 'listado-pipc';
}

function resolverLogoPath() {
    for (const logoPath of LOGO_PATHS) {
        if (fs.existsSync(logoPath)) {
            return logoPath;
        }
    }
    return null;
}

function medirAlturaCelda(doc, texto, ancho, fontSize = 9) {
    doc.font('Helvetica').fontSize(fontSize);
    return Math.max(22, doc.heightOfString(String(texto || ''), { width: ancho - 8, align: 'left' }) + 10);
}

function dibujarBorde(doc, x, y, ancho, alto) {
    doc.lineWidth(0.6).strokeColor(COLOR_BORDER).rect(x, y, ancho, alto).stroke();
}

function dibujarCelda(doc, texto, x, y, ancho, alto, opciones = {}) {
    const {
        fill = null,
        textColor = COLOR_TEXT,
        fontSize = 9,
        bold = false,
        align = 'left',
        valign = 'top',
        lineGap = 0,
        singleLine = false
    } = opciones;

    dibujarBorde(doc, x, y, ancho, alto);
    if (fill) {
        doc.save();
        doc.fillColor(fill).rect(x, y, ancho, alto).fill();
        doc.restore();
        dibujarBorde(doc, x, y, ancho, alto);
    }

    const textoLimpio = String(texto || '').trim();
    if (!textoLimpio) return;

    const paddingX = 4;
    doc.fillColor(textColor).font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(fontSize);

    const textWidth = ancho - paddingX * 2;
    const textOpts = {
        width: textWidth,
        align,
        lineGap
    };
    if (singleLine) {
        textOpts.lineBreak = false;
    }

    let textY = y + 3;
    if (valign === 'middle') {
        const textH = singleLine
            ? fontSize
            : doc.heightOfString(textoLimpio, textOpts);
        textY = y + Math.max(1, (alto - textH) / 2);
    }

    doc.text(textoLimpio, x + paddingX, textY, textOpts);
}

function dibujarEncabezadoExcel(doc, left, y, pageWidth, tituloUbicacion, meta) {
    const colLogo = pageWidth * 0.26;
    const colCentro = pageWidth * 0.48;
    const colMeta = pageWidth * 0.26;

    const hSgc = 15;
    const hMeta = 15;
    const hListado = hMeta * 2;
    const headerH = hSgc + hListado;

    dibujarBorde(doc, left, y, colLogo, headerH);
    const logoPath = resolverLogoPath();
    if (logoPath) {
        try {
            doc.image(logoPath, left + 6, y + 4, {
                fit: [colLogo - 12, headerH - 8],
                align: 'center',
                valign: 'center'
            });
        } catch (_) {
            dibujarCelda(doc, 'BIZNAGA\nSeguridad e Higiene\nIndustrial & Ambiental', left, y, colLogo, headerH, {
                fontSize: 7,
                bold: true,
                valign: 'middle'
            });
        }
    } else {
        dibujarCelda(doc, 'BIZNAGA\nSeguridad e Higiene\nIndustrial & Ambiental', left, y, colLogo, headerH, {
            fontSize: 7,
            bold: true,
            valign: 'middle'
        });
    }

    const centroX = left + colLogo;
    dibujarCelda(doc, 'SISTEMA DE GESTIÓN DE CALIDAD', centroX, y, colCentro, hSgc, {
        fill: COLOR_GRAY_BG,
        fontSize: 8,
        bold: true,
        align: 'center',
        valign: 'middle',
        singleLine: true
    });

    dibujarCelda(doc, 'LISTADO MAESTRO DE DOCUMENTACIÓN A SOLICITAR', centroX, y + hSgc, colCentro, hListado, {
        fill: '#FFFFFF',
        fontSize: 9,
        bold: true,
        align: 'center',
        valign: 'middle',
        singleLine: true
    });

    const metaX = left + colLogo + colCentro;
    dibujarCelda(doc, `Código: ${meta.codigo}`, metaX, y, colMeta, hMeta, {
        fill: COLOR_GRAY_BG,
        fontSize: 7.5,
        valign: 'middle',
        singleLine: true
    });
    dibujarCelda(doc, `Revisión: ${meta.revision}`, metaX, y + hMeta, colMeta, hMeta, {
        fill: COLOR_GRAY_BG,
        fontSize: 7.5,
        valign: 'middle',
        singleLine: true
    });
    dibujarCelda(doc, `Fecha de rev.: ${meta.fechaRevision}`, metaX, y + hMeta * 2, colMeta, hMeta, {
        fill: COLOR_GRAY_BG,
        fontSize: 7.5,
        valign: 'middle',
        singleLine: true
    });

    y += headerH;
    const hUbicacion = 18;
    dibujarCelda(doc, tituloUbicacion, left, y, pageWidth, hUbicacion, {
        fill: COLOR_GRAY_BG,
        fontSize: 9,
        bold: true,
        align: 'center',
        valign: 'middle',
        singleLine: true
    });
    y += hUbicacion;

    return y;
}

function generarListadoPipcPdf({
    tituloUbicacion = 'PIPC',
    items = [],
    codigo = 'SP-F-01',
    revision = '01',
    fechaRevision = '08-01-25'
} = {}) {
    return new Promise((resolve, reject) => {
        try {
            const doc = new PDFDocument({ size: 'LETTER', margin: 28, autoFirstPage: true });
            const chunks = [];
            doc.on('data', (chunk) => chunks.push(chunk));
            doc.on('end', () => resolve(Buffer.concat(chunks)));
            doc.on('error', reject);

            const pageWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right;
            const left = doc.page.margins.left;
            let y = dibujarEncabezadoExcel(doc, left, doc.page.margins.top, pageWidth, tituloUbicacion, {
                codigo,
                revision,
                fechaRevision
            });

            const colItem = 42;
            const colEntregado = 78;
            const colObs = 92;
            const colDatos = pageWidth - colItem - colEntregado - colObs;
            const headers = ['Item', 'Datos o documentos que se necesitan para el trámite', 'Entregado (Sí/No)', 'Observaciones'];
            const widths = [colItem, colDatos, colEntregado, colObs];
            let x = left;
            headers.forEach((header, idx) => {
                dibujarCelda(doc, header, x, y, widths[idx], 26, {
                    fill: COLOR_HEADER,
                    textColor: '#FFFFFF',
                    fontSize: 8,
                    bold: true,
                    align: 'center',
                    valign: 'middle'
                });
                x += widths[idx];
            });
            y += 26;

            const itemsPdf = (items || []).filter((item) => String(item?.documento || item?.nombre || '').trim());
            itemsPdf.forEach((item, index) => {
                const documento = String(item.documento || item.nombre || '').trim();
                const observaciones = String(item.especificacion || item.observaciones || '').trim();
                const altoFila = Math.max(
                    medirAlturaCelda(doc, documento, colDatos, 9),
                    medirAlturaCelda(doc, observaciones, colObs, 8),
                    24
                );

                if (y + altoFila > doc.page.height - doc.page.margins.bottom) {
                    doc.addPage();
                    y = doc.page.margins.top;
                }

                x = left;
                dibujarCelda(doc, String(index + 1), x, y, colItem, altoFila, { align: 'center', valign: 'middle' });
                x += colItem;
                dibujarCelda(doc, documento, x, y, colDatos, altoFila, { fontSize: 9, valign: 'middle' });
                x += colDatos;
                const entregado = String(item.entregado || '').trim();
                dibujarCelda(doc, entregado, x, y, colEntregado, altoFila, {
                    align: 'center',
                    valign: 'middle',
                    bold: entregado === 'Sí' || entregado === 'No',
                    textColor: entregado === 'Sí' ? '#1a7f37' : (entregado === 'No' ? '#c0392b' : COLOR_TEXT)
                });
                x += colEntregado;
                dibujarCelda(doc, observaciones, x, y, colObs, altoFila, { fontSize: 8, valign: 'middle' });
                y += altoFila;
            });

            doc.end();
        } catch (error) {
            reject(error);
        }
    });
}

module.exports = {
    generarListadoPipcPdf,
    sanitizarNombreArchivo
};
