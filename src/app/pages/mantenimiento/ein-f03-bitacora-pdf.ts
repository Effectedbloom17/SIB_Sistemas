import jsPDF from 'jspdf';

/** Carta horizontal. Arriba 1,6 cm, abajo 1,3 cm y 1 cm a cada lado. */
const PAGE_W = 279.4;
const PAGE_H = 215.9;
const MARGIN_T = 16;
const MARGIN_B = 13;
const MARGIN_X = 10;

const HEADER_H = 22;
const GAP = 1.6;
const FOOT_H = 0;
const GRIS_EXCEL = [216, 216, 216] as const;
const FONT_MAX = 6.6;
const FONT_MIN = 4.6;

export interface BitacoraPdfMeta {
  codigo: string;
  revision: string;
  fechaRev: string;
  clausula: string;
  titulo: string;
}

export interface FilaBitacoraPdf {
  no: number;
  infraestructura: string;
  idSerie: string;
  tipo: string;
  internoExterno: string;
  actividades: string;
  responsable: string;
  fecha: string;
  observaciones: string;
}

interface LogoPdf {
  dataUrl: string;
}

interface ColumnaPdf {
  key: keyof FilaBitacoraPdf;
  label: string;
  w: number;
  align: 'left' | 'center';
}

const COLUMNAS: Array<Omit<ColumnaPdf, 'w'> & { w: number }> = [
  { key: 'no', label: 'No.', w: 10, align: 'left' },
  { key: 'infraestructura', label: 'Tipo de infraestructura', w: 36, align: 'left' },
  { key: 'idSerie', label: 'ID o No. de serie', w: 30, align: 'left' },
  { key: 'tipo', label: 'Tipo de mantenimiento', w: 24, align: 'left' },
  { key: 'internoExterno', label: 'Interno o Externo', w: 20, align: 'left' },
  { key: 'actividades', label: 'Actividades de mantenimienito', w: 68, align: 'left' },
  { key: 'responsable', label: 'Responsable del mantenimiento', w: 32, align: 'left' },
  { key: 'fecha', label: 'Fecha en que se realizó el mantenimiento', w: 28, align: 'left' },
  { key: 'observaciones', label: 'Observaciones', w: 28, align: 'left' }
];

export async function exportarBitacoraMantenimientoPdf(
  meta: BitacoraPdfMeta,
  filas: FilaBitacoraPdf[]
): Promise<void> {
  const logo = await cargarLogo();
  const pdf = construirPdfBitacoraMantenimiento(meta, filas, logo);
  pdf.save('EIN-F-03 Bitácora de mantenimiento.pdf');
}

export function construirPdfBitacoraMantenimiento(
  meta: BitacoraPdfMeta,
  filas: FilaBitacoraPdf[],
  logo: LogoPdf | null
): jsPDF {
  const pdf = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'letter', compress: true });
  pdf.setProperties({
    title: 'EIN-F-03 Bitácora de mantenimiento',
    subject: 'Bitácora de mantenimiento',
    creator: 'BIZNAGA RISK AND TECH'
  });

  const x = MARGIN_X;
  const tableW = PAGE_W - MARGIN_X * 2;
  const columnas = escalarColumnas(tableW);
  const altoTabla = PAGE_H - MARGIN_T - MARGIN_B - HEADER_H - GAP - FOOT_H;
  const datos = filas.length ? filas : [filaVacia()];
  const paginas = paginar(pdf, columnas, datos, altoTabla);

  paginas.forEach((pagina, indice) => {
    if (indice > 0) {
      pdf.addPage();
    }
    dibujarEncabezado(pdf, meta, logo, x, MARGIN_T, tableW);
    dibujarTabla(pdf, columnas, pagina.filas, x, MARGIN_T + HEADER_H + GAP, pagina);
  });
  return pdf;
}

function filaVacia(): FilaBitacoraPdf {
  return {
    no: 0,
    infraestructura: 'Sin registros',
    idSerie: '',
    tipo: '',
    internoExterno: '',
    actividades: '',
    responsable: '',
    fecha: '',
    observaciones: ''
  };
}

function escalarColumnas(tableW: number): ColumnaPdf[] {
  const suma = COLUMNAS.reduce((total, col) => total + col.w, 0);
  const factor = tableW / suma;
  return COLUMNAS.map(col => ({ ...col, w: col.w * factor }));
}

function paginar(
  pdf: jsPDF,
  columnas: ColumnaPdf[],
  filas: FilaBitacoraPdf[],
  altoTabla: number
): Array<{ font: number; headH: number; rowHs: number[]; filas: FilaBitacoraPdf[] }> {
  let font = FONT_MAX;
  let medida = medir(pdf, columnas, filas, font);
  while (medida.headH + suma(medida.rowHs) > altoTabla && font > FONT_MIN) {
    font = Math.round((font - 0.2) * 10) / 10;
    medida = medir(pdf, columnas, filas, font);
  }
  if (medida.headH + suma(medida.rowHs) <= altoTabla) {
    return [{ ...medida, filas }];
  }

  const paginas: Array<{ font: number; headH: number; rowHs: number[]; filas: FilaBitacoraPdf[] }> = [];
  let inicio = 0;
  while (inicio < filas.length) {
    const lote: FilaBitacoraPdf[] = [];
    const altos: number[] = [];
    while (inicio + lote.length < filas.length) {
      const alto = Math.min(medida.rowHs[inicio + lote.length], Math.max(4.4, altoTabla - medida.headH));
      if (lote.length && medida.headH + suma(altos) + alto > altoTabla) {
        break;
      }
      lote.push(filas[inicio + lote.length]);
      altos.push(alto);
    }
    paginas.push({ font: medida.font, headH: medida.headH, rowHs: altos, filas: lote });
    inicio += lote.length;
  }
  return paginas;
}

function medir(
  pdf: jsPDF,
  columnas: ColumnaPdf[],
  filas: FilaBitacoraPdf[],
  font: number
): { font: number; headH: number; rowHs: number[] } {
  const headLines = Math.max(
    1,
    ...columnas.map(col => partir(pdf, col.label, col.w, font, 'bold').length)
  );
  const headH = Math.max(7.2, headLines * font * 0.42 + 1.6);
  const rowHs = filas.map(fila => {
    const lineas = Math.max(
      1,
      ...columnas.map(col => partir(pdf, textoCelda(fila, col.key), col.w, font, 'normal').length)
    );
    return Math.max(4.4, lineas * font * 0.4 + 1.3);
  });
  return { font, headH, rowHs };
}

function dibujarEncabezado(
  pdf: jsPDF,
  meta: BitacoraPdfMeta,
  logo: LogoPdf | null,
  x: number,
  y: number,
  w: number
): void {
  const metaW = 62;
  const logoW = 58;
  const titleX = x + logoW;
  const titleW = w - logoW - metaW;
  const metaX = x + w - metaW;
  const filaH = HEADER_H / 3;

  pdf.setFillColor(GRIS_EXCEL[0], GRIS_EXCEL[1], GRIS_EXCEL[2]);
  pdf.rect(titleX, y, titleW, filaH, 'F');
  pdf.rect(metaX, y, metaW, HEADER_H, 'F');

  pdf.setDrawColor(0, 0, 0);
  pdf.setLineWidth(0.3);
  pdf.rect(x, y, w, HEADER_H);
  pdf.setLineWidth(0.2);
  pdf.line(titleX, y, titleX, y + HEADER_H);
  pdf.line(metaX, y, metaX, y + HEADER_H);
  pdf.line(metaX, y + filaH, metaX + metaW, y + filaH);
  pdf.line(metaX, y + filaH * 2, metaX + metaW, y + filaH * 2);
  pdf.line(titleX, y + filaH, titleX + titleW, y + filaH);

  if (logo?.dataUrl) {
    try {
      const caja = ajustarImagen(pdf, logo.dataUrl, logoW - 4, HEADER_H - 3);
      pdf.addImage(logo.dataUrl, 'PNG', x + (logoW - caja.w) / 2, y + (HEADER_H - caja.h) / 2, caja.w, caja.h);
    } catch {
      marcaTexto(pdf, x, y, logoW);
    }
  } else {
    marcaTexto(pdf, x, y, logoW);
  }

  pdf.setTextColor(0, 0, 0);
  pdf.setFont('helvetica', 'bold');
  pdf.setFontSize(8);
  centrar(pdf, `SISTEMA DE GESTIÓN DE CALIDAD [${meta.clausula || '7.1.3'}]`, titleX, y + filaH * 0.68, titleW);
  pdf.setFontSize(12);
  centrar(pdf, 'BITÁCORA DE MANTENIMIENTO', titleX, y + filaH + (HEADER_H - filaH) * 0.55, titleW);

  const metas = [
    `Código: ${meta.codigo || 'EIN-F-03'}`,
    `Revisión: ${meta.revision || '00'}`,
    `Fecha de revisión: ${meta.fechaRev || ''}`
  ];
  pdf.setFontSize(7.5);
  metas.forEach((texto, i) => {
    pdf.text(texto, metaX + 1.6, y + filaH * i + filaH * 0.64);
  });
}

function dibujarTabla(
  pdf: jsPDF,
  columnas: ColumnaPdf[],
  filas: FilaBitacoraPdf[],
  x: number,
  y: number,
  medida: { font: number; headH: number; rowHs: number[] }
): void {
  const tableW = columnas.reduce((total, col) => total + col.w, 0);
  const bodyH = suma(medida.rowHs);
  const gridH = medida.headH + bodyH;

  pdf.setFillColor(255, 255, 255);
  pdf.rect(x, y, tableW, medida.headH, 'F');
  pdf.setTextColor(0, 0, 0);
  pdf.setFont('helvetica', 'bold');
  pdf.setFontSize(Math.max(5.2, medida.font));
  let cx = x;
  columnas.forEach(col => {
    textoEnCaja(pdf, col.label, cx, y, col.w, medida.headH, 'center');
    cx += col.w;
  });

  filas.forEach((fila, i) => {
    const ry = y + medida.headH + medida.rowHs.slice(0, i).reduce((a, b) => a + b, 0);
    const rh = medida.rowHs[i];
    if (i % 2 === 0) {
      pdf.setFillColor(GRIS_EXCEL[0], GRIS_EXCEL[1], GRIS_EXCEL[2]);
      pdf.rect(x, ry, tableW, rh, 'F');
    }
    let colX = x;
    columnas.forEach(col => {
      pdf.setFont('helvetica', 'normal');
      pdf.setFontSize(medida.font);
      pdf.setTextColor(0, 0, 0);
      textoEnCaja(pdf, textoCelda(fila, col.key), colX, ry, col.w, rh, col.align);
      colX += col.w;
    });
  });

  pdf.setDrawColor(0, 0, 0);
  pdf.setLineWidth(0.2);
  pdf.rect(x, y, tableW, gridH);
  let lx = x;
  columnas.forEach(col => {
    lx += col.w;
    if (lx < x + tableW - 0.2) {
      pdf.line(lx, y, lx, y + gridH);
    }
  });
  pdf.line(x, y + medida.headH, x + tableW, y + medida.headH);
  let ly = y + medida.headH;
  medida.rowHs.forEach(alto => {
    ly += alto;
    pdf.line(x, ly, x + tableW, ly);
  });
}

function textoCelda(fila: FilaBitacoraPdf, key: keyof FilaBitacoraPdf): string {
  if (key === 'no') {
    return fila.no ? String(fila.no) : '';
  }
  return String(fila[key] || '').replace(/\s+/g, ' ').trim();
}

function partir(pdf: jsPDF, texto: string, w: number, font: number, estilo: 'normal' | 'bold'): string[] {
  pdf.setFont('helvetica', estilo);
  pdf.setFontSize(font);
  const lineas = pdf.splitTextToSize(texto || '', Math.max(4, w - 1.4));
  return lineas.length ? lineas : [''];
}

function textoEnCaja(
  pdf: jsPDF,
  texto: string,
  x: number,
  y: number,
  w: number,
  h: number,
  align: 'left' | 'center'
): void {
  const font = pdf.getFontSize();
  const estilo = pdf.getFont().fontStyle === 'bold' ? 'bold' : 'normal';
  const lineas = partir(pdf, texto, w, font, estilo).slice(0, Math.max(1, Math.floor((h - 0.6) / (font * 0.4))));
  pdf.setFont('helvetica', estilo);
  pdf.setFontSize(font);
  const lineH = font * 0.4;
  let ty = y + (h - lineas.length * lineH) / 2 + lineH * 0.78;
  lineas.forEach(linea => {
    const tx = align === 'center'
      ? x + (w - pdf.getTextWidth(linea)) / 2
      : x + 0.7;
    pdf.text(linea, tx, ty);
    ty += lineH;
  });
}

function centrar(pdf: jsPDF, texto: string, x: number, baseline: number, w: number): void {
  pdf.text(texto, x + (w - pdf.getTextWidth(texto)) / 2, baseline);
}

function suma(valores: number[]): number {
  return valores.reduce((total, valor) => total + valor, 0);
}

function ajustarImagen(pdf: jsPDF, dataUrl: string, maxW: number, maxH: number): { w: number; h: number } {
  const props = pdf.getImageProperties(dataUrl);
  const ratio = props.width / Math.max(1, props.height);
  let w = maxW;
  let h = w / ratio;
  if (h > maxH) {
    h = maxH;
    w = h * ratio;
  }
  return { w, h };
}

function marcaTexto(pdf: jsPDF, x: number, y: number, w: number): void {
  pdf.setTextColor(55, 65, 75);
  pdf.setFont('helvetica', 'bold');
  pdf.setFontSize(9);
  centrar(pdf, 'BIZNAGA', x, y + HEADER_H / 2 + 1, w);
}

async function cargarLogo(): Promise<LogoPdf | null> {
  if (typeof fetch !== 'function' || typeof FileReader === 'undefined') {
    return null;
  }
  try {
    const res = await fetch('assets/img/sgc-f03-logo.png');
    if (!res.ok) {
      return null;
    }
    const blob = await res.blob();
    const dataUrl = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ''));
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(blob);
    });
    return dataUrl ? { dataUrl } : null;
  } catch {
    return null;
  }
}
