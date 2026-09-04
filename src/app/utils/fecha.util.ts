/**
 * Utilidades de fechas para campos de solo-día (sin hora) y visualización local.
 * Evita el desfase de un día causado por parsear "YYYY-MM-DD" como UTC.
 */

const MESES_CORTOS_ES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];

/** Indica si el valor representa una fecha sin componente horario relevante. */
export function esFechaSoloDia(valor: unknown): boolean {
  const s = String(valor ?? '').trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(s)
    || /^\d{4}-\d{2}-\d{2}T00:00:00(\.000)?Z?$/.test(s);
}

/**
 * Parsea fechas de solo-día sin desfase por zona horaria.
 * Acepta "YYYY-MM-DD" o ISO con hora ("2025-05-23T00:00:00.000Z").
 */
export function parsearFechaSoloDia(fechaRaw: unknown): Date | null {
  if (fechaRaw instanceof Date && !Number.isNaN(fechaRaw.getTime())) {
    return new Date(fechaRaw.getFullYear(), fechaRaw.getMonth(), fechaRaw.getDate());
  }

  const fecha = String(fechaRaw ?? '').trim();
  if (!fecha) {
    return null;
  }

  const soloFecha = fecha.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (soloFecha) {
    const anio = Number(soloFecha[1]);
    const mes = Number(soloFecha[2]);
    const dia = Number(soloFecha[3]);
    return new Date(anio, mes - 1, dia);
  }

  const match = fecha.match(/(\d{2})\/(\d{2})\/(\d{4})/);
  if (match) {
    const parsed = new Date(Number(match[3]), Number(match[2]) - 1, Number(match[1]));
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }

  const parsed = new Date(fecha);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }

  return new Date(parsed.getFullYear(), parsed.getMonth(), parsed.getDate());
}

/** Parsea fechas de solo-día o timestamps completos según el formato recibido. */
export function parsearFechaFlexible(valor: unknown): Date | null {
  if (!valor) {
    return null;
  }

  if (esFechaSoloDia(valor)) {
    return parsearFechaSoloDia(valor);
  }

  const directa = new Date(String(valor));
  return Number.isNaN(directa.getTime()) ? null : directa;
}

/** Normaliza a YYYY-MM-DD para inputs type="date". */
export function normalizarFechaInput(fechaRaw: unknown): string {
  if (!fechaRaw) {
    return '';
  }

  if (typeof fechaRaw === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(fechaRaw)) {
    return fechaRaw;
  }

  if (esFechaSoloDia(fechaRaw)) {
    return String(fechaRaw).trim().slice(0, 10);
  }

  const d = new Date(String(fechaRaw));
  if (Number.isNaN(d.getTime())) {
    return '';
  }

  const mes = String(d.getMonth() + 1).padStart(2, '0');
  const dia = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${mes}-${dia}`;
}

/** Formato DD/MM/YYYY para fechas de curso (sin hora). */
export function formatearFechaDdmmaaaa(fechaRaw: unknown): string {
  const date = parsearFechaSoloDia(fechaRaw);
  if (!date) {
    return '';
  }

  const day = String(date.getDate()).padStart(2, '0');
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const year = date.getFullYear();
  return `${day}/${month}/${year}`;
}

/** Formato visual DD/MM/YYYY; soporta fechas de solo-día y timestamps. */
export function formatearFechaVisual(fechaRaw: unknown): string {
  if (!fechaRaw) {
    return '--';
  }

  if (esFechaSoloDia(fechaRaw)) {
    return formatearFechaDdmmaaaa(fechaRaw) || '--';
  }

  const normalizada = normalizarFechaInput(fechaRaw);
  if (!normalizada) {
    return '--';
  }

  const [anio, mes, dia] = normalizada.split('-');
  return `${dia}/${mes}/${anio}`;
}

/** Timestamp local de medianoche para ordenar fechas de solo-día. */
export function fechaSoloDiaATimestamp(fechaRaw: unknown): number {
  return parsearFechaSoloDia(fechaRaw)?.getTime() ?? 0;
}

/** Formato "23 may 2025" para fechas de curso (sin hora). */
export function formatearFechaCursoEs(fechaRaw: unknown): string {
  const date = parsearFechaSoloDia(fechaRaw);
  if (!date) {
    return '';
  }

  const day = String(date.getDate()).padStart(2, '0');
  const month = MESES_CORTOS_ES[date.getMonth()];
  const year = date.getFullYear();
  return `${day} ${month} ${year}`;
}

/** Formato "23-may-26" para fechas de curso (sin hora). */
export function formatearFechaCursoCortoEs(fechaRaw: unknown): string {
  const date = parsearFechaSoloDia(fechaRaw);
  if (!date) {
    return '';
  }

  const day = String(date.getDate()).padStart(2, '0');
  const month = MESES_CORTOS_ES[date.getMonth()];
  const year = String(date.getFullYear()).slice(-2);
  return `${day}-${month}-${year}`;
}

/** Compara una fecha de curso contra una referencia local (por defecto hoy). */
export function esMismaFechaLocal(fechaRaw: unknown, referencia: Date = new Date()): boolean {
  const date = parsearFechaSoloDia(fechaRaw);
  if (!date) {
    return false;
  }

  return date.getFullYear() === referencia.getFullYear()
    && date.getMonth() === referencia.getMonth()
    && date.getDate() === referencia.getDate();
}

/** Fin del día local (23:59:59.999) para comparar fechas de curso. */
export function obtenerFinDiaTimestamp(fechaRaw: unknown): number | null {
  const date = parsearFechaSoloDia(fechaRaw);
  if (!date) {
    return null;
  }

  date.setHours(23, 59, 59, 999);
  return date.getTime();
}

/** Inicio del día local (00:00:00) para filtros por rango. */
export function obtenerInicioDiaTimestamp(fechaRaw: unknown): number | null {
  const date = parsearFechaSoloDia(fechaRaw);
  if (!date) {
    return null;
  }

  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

/** Formato HH:mm para hora_inicio / hora_fin de curso. */
export function formatearHoraCurso(horaRaw: unknown): string {
  const hora = String(horaRaw ?? '').trim();
  if (!hora) {
    return '';
  }

  const partes = hora.split(':');
  if (partes.length >= 2) {
    return `${partes[0].padStart(2, '0')}:${partes[1].padStart(2, '0')}`;
  }

  return hora;
}

/** Hora en formato 12 h (ej. 3:34 pm). */
export function formatearHora12hMexico(hh24: number, min: number): string {
  const period = hh24 >= 12 ? 'pm' : 'am';
  const hh12 = hh24 % 12 || 12;
  return `${hh12}:${String(min).padStart(2, '0')} ${period}`;
}

/**
 * Fecha y hora de descarga en zona México, formato DD/MM/YYYY h:mm am/pm.
 * Trata cadenas MySQL sin zona horaria como hora local de México (sin desfase).
 */
export function formatearFechaHoraDescargaMexico(valor: unknown): string {
  if (!valor) {
    return 'Sin registro';
  }

  const texto = String(valor).trim();
  const matchNaive = texto.match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::\d{2})?(?:\.\d+)?$/);
  if (matchNaive && !texto.endsWith('Z') && !/[+-]\d{2}:\d{2}$/.test(texto)) {
    const [, yyyy, mm, dd, hh, min] = matchNaive;
    return `${dd}/${mm}/${yyyy} ${formatearHora12hMexico(Number(hh), Number(min))}`;
  }

  const fecha = new Date(texto);
  if (Number.isNaN(fecha.getTime())) {
    return texto;
  }

  const partes = new Intl.DateTimeFormat('es-MX', {
    timeZone: 'America/Mexico_City',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true
  }).formatToParts(fecha);

  const get = (type: Intl.DateTimeFormatPartTypes) =>
    partes.find((p) => p.type === type)?.value || '';

  const dd = get('day');
  const mm = get('month');
  const yyyy = get('year');
  const hh = get('hour');
  const min = get('minute');
  const period = (get('dayPeriod') || '').toLowerCase();

  return `${dd}/${mm}/${yyyy} ${hh}:${min} ${period}`.trim();
}

/** YYYY-MM-DD del día actual en hora local. */
export function obtenerFechaHoyLocal(): string {
  const hoy = new Date();
  const year = hoy.getFullYear();
  const month = String(hoy.getMonth() + 1).padStart(2, '0');
  const day = String(hoy.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}
