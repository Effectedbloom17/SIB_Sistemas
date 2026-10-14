import jsPDF from 'jspdf';
import {
  EinF01Meta,
  EstadoCeldaPrograma,
  InfraestructuraFila,
  MESES_EIN_F01,
  SEMANAS_POR_MES,
  claveSemana
} from './ein-f01-programa.catalog';

/** Carta horizontal. Arriba 1,6 cm, abajo 1,3 cm y 1 cm a cada lado para que la impresora no corte el borde. */
const PAGE_W = 279.4;
const PAGE_H = 215.9;
const MARGIN_T = 16;
const MARGIN_B = 13;
const MARGIN_X = 10;

const HEADER_H = 16;
const INFO_GAP = 1.5;
const INFO_H = 8.2;
const GRID_GAP = 1.2;
const OBS_H = 4.8;
const SIGN_GAP = 2.2;
const SIGN_H = 32;

const MONTH_H = 4.7;
const WEEK_H = 3.4;
const ROW_H = 6.4;
const FOOTER_H = OBS_H + SIGN_GAP + SIGN_H + 2.4;

const COL_INFRA = 40;
const COL_RESP = 36;
const COL_TIPO = 10.5;

const OBSERVACIONES =
  'Si hay algún cambio durante la implementación de este programa, por ejemplo, cambio en las fechas establecidas o cambio de proveedor externo, éste se informa a la autoridad pertinente.';

const FIRMAS: Array<{ titulo: string; cargo: string }> = [
  { titulo: 'ELABORÓ', cargo: 'Ejec. Sist. Gest. y Ca' },
  { titulo: 'REVISÓ', cargo: 'Gerente de Estrategias e Innovación' },
  { titulo: 'APROBÓ', cargo: 'Directora General' }
];

export interface LogoPdf {
  dataUrl: string;
}

export async function exportarProgramaInfraestructuraPdf(
  meta: EinF01Meta,
  filas: InfraestructuraFila[]
): Promise<void> {
  const logo = await cargarLogo();
  const pdf = construirPdfProgramaInfraestructura(meta, filas, logo);
  const anio = Number(meta?.anio) || new Date().getFullYear();
  pdf.save(`EIN-F-01 Programa ${anio}.pdf`);
}

export function construirPdfProgramaInfraestructura(
  meta: EinF01Meta,
  filas: InfraestructuraFila[],
  logo: LogoPdf | null
): jsPDF {
  const pdf = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'letter', compress: true });
  pdf.setProperties({
    title: `EIN-F-01 Programa de mantenimiento ${meta?.anio || ''}`.trim(),
    subject: 'Programa de mantenimiento a la infraestructura',
    creator: 'BIZNAGA RISK AND TECH'
  });

  const x = MARGIN_X;
  const tableW = PAGE_W - MARGIN_X * 2;
  const yTop = MARGIN_T;
  const yBot = PAGE_H - MARGIN_B;
  const activas = (filas || []).filter(filaConInformacion);
  const tableHead = MONTH_H + WEEK_H;
  const yGrid = yTop + HEADER_H + INFO_GAP + INFO_H + GRID_GAP;
  const espacioConPie = yBot - yGrid - tableHead - FOOTER_H;
  const altoMinimo = 4.5;
  if (activas.length === 0 || activas.length * ROW_H <= espacioConPie || espacioConPie / Math.max(1, activas.length) >= altoMinimo) {
    const rowH = activas.length * ROW_H <= espacioConPie
      ? ROW_H
      : espacioConPie / Math.max(1, activas.length);
    dibujarEncabezado(pdf, meta, logo, x, yTop, tableW);
    dibujarDatosPrograma(pdf, meta, x, yTop + HEADER_H + INFO_GAP, tableW);
    dibujarTabla(pdf, activas, x, yGrid, tableW, rowH, activas.length);
    dibujarPie(pdf, x, yGrid + tableHead + activas.length * rowH, tableW);
    return pdf;
  }

  let index = 0;
  let pagina = 0;
  let pieDibujado = false;
  while (!pieDibujado) {
    if (pagina > 0) {
      pdf.addPage();
    }
    let y = yTop;
    if (pagina === 0) {
      dibujarEncabezado(pdf, meta, logo, x, y, tableW);
      dibujarDatosPrograma(pdf, meta, x, y + HEADER_H + INFO_GAP, tableW);
      y += HEADER_H + INFO_GAP + INFO_H + GRID_GAP;
    }

    const restantes = activas.length - index;
    if (restantes === 0) {
      dibujarPie(pdf, x, y, tableW);
      pieDibujado = true;
      pagina += 1;
      continue;
    }
    const cupoSinPie = Math.max(0, Math.floor((yBot - y - tableHead) / ROW_H));
    const cupoConPie = Math.max(0, Math.floor((yBot - y - tableHead - FOOTER_H) / ROW_H));

    if (restantes <= cupoConPie) {
      const slice = activas.slice(index);
      dibujarTabla(pdf, slice, x, y, tableW, ROW_H, slice.length);
      dibujarPie(pdf, x, y + tableHead + slice.length * ROW_H, tableW);
      pieDibujado = true;
    } else {
      const tomar = Math.min(restantes, Math.max(1, cupoSinPie));
      const slice = activas.slice(index, index + tomar);
      dibujarTabla(pdf, slice, x, y, tableW, ROW_H, slice.length);
      index += tomar;
    }
    pagina += 1;
  }

  return pdf;
}

function filaConInformacion(fila: InfraestructuraFila): boolean {
  const infra = String(fila?.infraestructura || '').replace(/\s+/g, ' ').trim();
  const resp = String(fila?.responsable || '').replace(/\s+/g, ' ').trim();
  const marcas = fila?.programado && typeof fila.programado === 'object'
    ? Object.keys(fila.programado).length
    : 0;
  return !!(infra || resp || marcas);
}

function dibujarEncabezado(
  pdf: jsPDF,
  meta: EinF01Meta,
  logo: LogoPdf | null,
  x: number,
  y: number,
  w: number
): void {
  const metaW = 54;
  const logoW = 62;
  const titleX = x + logoW;
  const titleW = w - logoW - metaW;
  const metaX = x + w - metaW;

  pdf.setDrawColor(75, 85, 99);
  pdf.setLineWidth(0.28);
  pdf.rect(x, y, w, HEADER_H);
  pdf.setLineWidth(0.18);
  pdf.line(titleX, y, titleX, y + HEADER_H);
  pdf.line(metaX, y, metaX, y + HEADER_H);

  if (logo?.dataUrl) {
    try {
      const caja = ajustarImagen(pdf, logo.dataUrl, logoW - 3.2, HEADER_H - 2.4);
      const ix = x + (logoW - caja.w) / 2;
      const iy = y + (HEADER_H - caja.h) / 2;
      pdf.addImage(logo.dataUrl, 'PNG', ix, iy, caja.w, caja.h);
    } catch {
      dibujarMarcaTexto(pdf, x, y, logoW);
    }
  } else {
    dibujarMarcaTexto(pdf, x, y, logoW);
  }

  pdf.setTextColor(71, 85, 105);
  pdf.setFont('helvetica', 'bold');
  pdf.setFontSize(6.2);
  textoCentrado(pdf, `SISTEMA DE GESTIÓN DE CALIDAD [${meta.clausula || '7.1.3'}]`, titleX, y + 5.1, titleW);

  pdf.setTextColor(15, 23, 42);
  pdf.setFontSize(8.4);
  textoCentrado(
    pdf,
    'PROGRAMA DE MANTENIMIENTO A LA INFRAESTRUCTURA',
    titleX,
    y + 10.6,
    titleW
  );

  const filasMeta: Array<[string, string]> = [
    ['Código:', meta.codigo || 'EIN-F-01'],
    ['Revisión:', meta.revision || '00'],
    ['Fecha de Rev:', meta.fechaRev || '']
  ];
  const filaMetaH = HEADER_H / filasMeta.length;
  filasMeta.forEach((fila, i) => {
    const fy = y + i * filaMetaH;
    if (i > 0) {
      pdf.setDrawColor(75, 85, 99);
      pdf.setLineWidth(0.15);
      pdf.line(metaX, fy, metaX + metaW, fy);
    }
    pdf.setFont('helvetica', 'normal');
    pdf.setFontSize(6.3);
    pdf.setTextColor(71, 85, 105);
    textoEnLinea(pdf, fila[0], metaX + 1.4, fy + filaMetaH * 0.66);
    pdf.setFont('helvetica', 'bold');
    pdf.setTextColor(15, 23, 42);
    const valor = String(fila[1] || '');
    const vw = pdf.getTextWidth(valor);
    textoEnLinea(pdf, valor, metaX + metaW - 1.4 - vw, fy + filaMetaH * 0.66);
  });
}

function dibujarDatosPrograma(pdf: jsPDF, meta: EinF01Meta, x: number, y: number, w: number): void {
  const izquierda = w * 0.58;
  const filas: Array<[string, string, string, string]> = [
    ['Empresa: ', meta.empresa || '', 'Periodo de programación: ', meta.periodo || ''],
    [
      'Tipo de infraestructura que se programa: ',
      meta.tipoInfraestructura || '',
      'Administrador del programa: ',
      meta.administrador || ''
    ]
  ];
  const lineH = INFO_H / filas.length;
  filas.forEach((fila, i) => {
    const baseline = y + lineH * i + lineH * 0.72;
    dibujarPar(pdf, fila[0], fila[1], x + 0.4, baseline, izquierda - 1.2, 'left');
    dibujarPar(pdf, fila[2], fila[3], x + izquierda, baseline, w - izquierda - 0.4, 'right');
  });
}

function dibujarTabla(
  pdf: jsPDF,
  filas: InfraestructuraFila[],
  x: number,
  y: number,
  tableW: number,
  rowH: number,
  filasPagina: number
): void {
  const weeksW = tableW - COL_INFRA - COL_RESP - COL_TIPO;
  const weekW = weeksW / (MESES_EIN_F01.length * SEMANAS_POR_MES.length);
  const monthW = weekW * SEMANAS_POR_MES.length;
  const gridH = MONTH_H + WEEK_H + rowH * filasPagina;
  const weekStartX = x + COL_INFRA + COL_RESP + COL_TIPO;
  const bodyY = y + MONTH_H + WEEK_H;

  pdf.setFillColor(108, 122, 138);
  pdf.rect(x, y, tableW, MONTH_H + WEEK_H, 'F');

  for (let i = 0; i < filasPagina; i++) {
    const fila = filas[i];
    const ry = bodyY + i * rowH;
    if (!fila) {
      continue;
    }
    const tipo = fila.tipo === 'Ext' ? 'Ext' : 'Int';
    if (tipo === 'Ext') {
      pdf.setFillColor(255, 236, 153);
    } else {
      pdf.setFillColor(198, 239, 206);
    }
    pdf.rect(x + COL_INFRA + COL_RESP, ry, COL_TIPO, rowH, 'F');

    for (let mes = 0; mes < MESES_EIN_F01.length; mes++) {
      for (let sem = 0; sem < SEMANAS_POR_MES.length; sem++) {
        const estado = estadoCelda(fila, mes, sem);
        if (!estado) {
          continue;
        }
        pdf.setFillColor(0, 176, 80);
        pdf.rect(weekStartX + (mes * 4 + sem) * weekW, ry, weekW, rowH, 'F');
      }
    }
  }

  pdf.setDrawColor(75, 85, 99);
  pdf.setLineWidth(0.16);
  pdf.line(x, y, x + tableW, y);
  pdf.line(weekStartX, y + MONTH_H, x + tableW, y + MONTH_H);
  pdf.line(x, bodyY, x + tableW, bodyY);
  for (let i = 1; i <= filasPagina; i++) {
    const ly = bodyY + i * rowH;
    pdf.line(x, ly, x + tableW, ly);
  }

  const cortesMes = [0, COL_INFRA, COL_INFRA + COL_RESP, COL_INFRA + COL_RESP + COL_TIPO];
  cortesMes.forEach(dx => pdf.line(x + dx, y, x + dx, y + gridH));
  pdf.line(x + tableW, y, x + tableW, y + gridH);
  for (let mes = 0; mes < MESES_EIN_F01.length; mes++) {
    const mx = weekStartX + mes * monthW;
    if (mes > 0) {
      pdf.line(mx, y, mx, y + gridH);
    }
    for (let sem = 1; sem < SEMANAS_POR_MES.length; sem++) {
      const sx = mx + sem * weekW;
      pdf.line(sx, y + MONTH_H, sx, y + gridH);
    }
  }

  pdf.setTextColor(255, 255, 255);
  pdf.setFont('helvetica', 'bold');
  pdf.setFontSize(5.1);
  textoCentradoVertical(pdf, 'INFRAESTRUCTURA', x, y, COL_INFRA, MONTH_H + WEEK_H);
  textoCentradoVertical(pdf, 'RESPONSABLE', x + COL_INFRA, y, COL_RESP, MONTH_H + WEEK_H);
  textoCentradoVertical(pdf, 'TIPO', x + COL_INFRA + COL_RESP, y, COL_TIPO, MONTH_H + WEEK_H);

  pdf.setFontSize(5.2);
  MESES_EIN_F01.forEach((mes, i) => {
    textoCentradoVertical(pdf, mes.toUpperCase(), weekStartX + i * monthW, y, monthW, MONTH_H);
  });
  pdf.setFontSize(4.4);
  for (let mes = 0; mes < MESES_EIN_F01.length; mes++) {
    SEMANAS_POR_MES.forEach((sem, si) => {
      textoCentradoVertical(
        pdf,
        String(sem),
        weekStartX + (mes * 4 + si) * weekW,
        y + MONTH_H,
        weekW,
        WEEK_H
      );
    });
  }

  const fontDatos = Math.max(3.8, Math.min(5.6, rowH * 1.05));
  for (let i = 0; i < filasPagina; i++) {
    const fila = filas[i];
    if (!fila) {
      continue;
    }
    const ry = bodyY + i * rowH;
    pdf.setTextColor(30, 41, 59);
    pdf.setFont('helvetica', 'normal');
    textoCelda(pdf, fila.infraestructura, x, ry, COL_INFRA, rowH, fontDatos, 'left');
    textoCelda(pdf, fila.responsable, x + COL_INFRA, ry, COL_RESP, rowH, fontDatos, 'left');

    const tipo = fila.tipo === 'Ext' ? 'Ext' : 'Int';
    pdf.setFont('helvetica', 'bold');
    pdf.setTextColor(tipo === 'Ext' ? 120 : 22, tipo === 'Ext' ? 80 : 101, tipo === 'Ext' ? 0 : 52);
    textoCentradoVertical(pdf, tipo, x + COL_INFRA + COL_RESP, ry, COL_TIPO, rowH);

    pdf.setTextColor(255, 255, 255);
    pdf.setFontSize(Math.max(4, Math.min(6.2, rowH * 1.15)));
    for (let mes = 0; mes < MESES_EIN_F01.length; mes++) {
      for (let sem = 0; sem < SEMANAS_POR_MES.length; sem++) {
        if (estadoCelda(fila, mes, sem) !== 'P') {
          continue;
        }
        textoCentradoVertical(
          pdf,
          'P',
          weekStartX + (mes * 4 + sem) * weekW,
          ry,
          weekW,
          rowH
        );
      }
    }
  }
}

function dibujarPie(pdf: jsPDF, x: number, y: number, w: number): void {
  const obsY = y + 3.2;
  const etiqueta = 'OBSERVACIONES: ';
  let obsSize = 5.7;
  let etiquetaW = 0;
  let resto = '';
  while (obsSize >= 4.6) {
    pdf.setFont('helvetica', 'bold');
    pdf.setFontSize(obsSize);
    etiquetaW = pdf.getTextWidth(etiqueta);
    pdf.setFont('helvetica', 'normal');
    const lineas = pdf.splitTextToSize(OBSERVACIONES, Math.max(20, w - etiquetaW - 1));
    if (lineas.length <= 1) {
      resto = lineas[0] || '';
      break;
    }
    obsSize -= 0.2;
    resto = lineas[0] || '';
  }
  pdf.setFont('helvetica', 'bold');
  pdf.setFontSize(obsSize);
  pdf.setTextColor(15, 23, 42);
  textoEnLinea(pdf, etiqueta, x + 0.3, obsY);
  pdf.setFont('helvetica', 'normal');
  textoEnLinea(pdf, resto, x + 0.3 + etiquetaW, obsY);

  const signY = y + OBS_H + SIGN_GAP;
  const grupoW = Math.min(w * 0.72, 198);
  const gap = 3.2;
  const boxW = (grupoW - gap * 2) / 3;
  let bx = x + (w - grupoW) / 2;
  pdf.setDrawColor(75, 85, 99);
  pdf.setLineWidth(0.25);
  FIRMAS.forEach(firma => {
    pdf.rect(bx, signY, boxW, SIGN_H);
    pdf.setFont('helvetica', 'bold');
    pdf.setFontSize(7);
    pdf.setTextColor(15, 23, 42);
    textoCentrado(pdf, firma.titulo, bx, signY + 4.6, boxW);
    pdf.setFont('helvetica', 'normal');
    pdf.setFontSize(6);
    pdf.setTextColor(51, 65, 85);
    textoCentrado(pdf, firma.cargo, bx, signY + SIGN_H - 2.8, boxW);
    bx += boxW + gap;
  });
}

function estadoCelda(
  fila: InfraestructuraFila,
  mes: number,
  semana: number
): EstadoCeldaPrograma | null {
  return fila?.programado?.[claveSemana(mes, semana)] || null;
}

function dibujarPar(
  pdf: jsPDF,
  etiqueta: string,
  valor: string,
  x: number,
  baseline: number,
  maxW: number,
  align: 'left' | 'right'
): void {
  pdf.setFontSize(6.4);
  pdf.setFont('helvetica', 'bold');
  pdf.setTextColor(15, 23, 42);
  const valorTxt = String(valor || '').replace(/\s+/g, ' ').trim();
  const valorW = pdf.getTextWidth(valorTxt);
  pdf.setFont('helvetica', 'normal');
  pdf.setTextColor(71, 85, 105);
  const etiquetaW = pdf.getTextWidth(etiqueta);
  const total = etiquetaW + valorW;
  const start = align === 'right' ? x + Math.max(0, maxW - total) : x;
  textoEnLinea(pdf, etiqueta, start, baseline);
  pdf.setFont('helvetica', 'bold');
  pdf.setTextColor(15, 23, 42);
  textoEnLinea(pdf, valorTxt, start + etiquetaW, baseline);
}

function textoCelda(
  pdf: jsPDF,
  raw: string,
  x: number,
  y: number,
  w: number,
  h: number,
  fontSize: number,
  align: 'left' | 'center'
): void {
  const padX = 0.7;
  const texto = String(raw || '').replace(/\r/g, '').trim();
  if (!texto) {
    return;
  }
  pdf.setFont('helvetica', 'normal');
  pdf.setFontSize(fontSize);
  const lineH = fontSize * 0.36;
  const maxLines = Math.max(1, Math.floor((h - 0.35) / lineH));
  const partes = texto.split('\n').flatMap(parte => pdf.splitTextToSize(parte.trim(), Math.max(2, w - padX * 2)));
  const lines = partes.slice(0, maxLines);
  const blockH = lines.length * lineH;
  let ty = y + (h - blockH) / 2 + lineH * 0.78;
  lines.forEach(line => {
    const tx = align === 'center'
      ? x + (w - pdf.getTextWidth(line)) / 2
      : x + padX;
    pdf.text(line, tx, ty);
    ty += lineH;
  });
}

function textoCentrado(pdf: jsPDF, texto: string, x: number, baseline: number, w: number): void {
  const ancho = pdf.getTextWidth(texto);
  pdf.text(texto, x + (w - ancho) / 2, baseline);
}

function textoCentradoVertical(pdf: jsPDF, texto: string, x: number, y: number, w: number, h: number): void {
  const fontSize = pdf.getFontSize();
  const baseline = y + h / 2 + fontSize * 0.12;
  textoCentrado(pdf, texto, x, baseline, w);
}

function textoEnLinea(pdf: jsPDF, texto: string, x: number, baseline: number): void {
  pdf.text(texto, x, baseline);
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

function dibujarMarcaTexto(pdf: jsPDF, x: number, y: number, w: number): void {
  pdf.setTextColor(55, 65, 75);
  pdf.setFont('helvetica', 'bold');
  pdf.setFontSize(9);
  textoCentrado(pdf, 'BIZNAGA', x, y + HEADER_H / 2 + 1, w);
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
