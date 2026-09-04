/**
 * Traduce mensajes técnicos (SQL, HTTP, validación) a texto claro para usuarios finales.
 */

const REGLAS_ERROR_REGISTRO: Array<{ patron: RegExp; mensaje: string }> = [
  { patron: /duplicate entry|er_dup_entry|unique constraint|already exists|ya existe|ya está inscrito|ya estaba inscrito/i,
    mensaje: 'Este empleado ya está registrado o ya participa en este curso.' },
  { patron: /cannot be null|er_bad_null_error|not null|campo obligatorio|se requiere/i,
    mensaje: 'Faltan datos obligatorios. Verifica que el nombre y el CURP estén completos.' },
  { patron: /data too long|value too long|demasiado largo/i,
    mensaje: 'Algún dato es demasiado largo. Revisa nombre, CURP o puesto.' },
  { patron: /incorrect .* value|invalid|inválid|formato|curp/i,
    mensaje: 'El formato de algún dato no es válido. Revisa especialmente el CURP.' },
  { patron: /foreign key|constraint fails|vincular/i,
    mensaje: 'No se pudo vincular el empleado con la empresa o el curso.' },
  { patron: /connection|econnrefused|timeout|timed out|network/i,
    mensaje: 'No se pudo conectar con el servidor. Verifica tu conexión e intenta de nuevo.' },
  { patron: /cupo|capacidad|lleno|no hay lugares/i,
    mensaje: 'El curso ya no tiene cupo disponible para más empleados.' },
  { patron: /no encontrado|not found|404/i,
    mensaje: 'No se encontró el curso o la empresa. Actualiza la página e intenta de nuevo.' },
  { patron: /permiso|autoriz|forbidden|401|403/i,
    mensaje: 'No tienes permiso para realizar esta acción.' }
];

/** Traduce un mensaje técnico individual a lenguaje sencillo. */
export function traducirMensajeError(mensaje: string): string {
  const texto = String(mensaje || '').trim();
  if (!texto) {
    return 'Ocurrió un error inesperado. Intenta nuevamente.';
  }

  for (const regla of REGLAS_ERROR_REGISTRO) {
    if (regla.patron.test(texto)) {
      return regla.mensaje;
    }
  }

  if (/^error\b/i.test(texto) || /exception|sql|query|stack|undefined|null pointer/i.test(texto)) {
    return 'No se pudo completar el registro. Revisa los datos e intenta de nuevo.';
  }

  return texto;
}

/** Traduce errores del backend al registrar empleados (incluye nombre del empleado). */
export function traducirErrorRegistroEmpleado(error: string, nombreEmpleado?: string): string {
  const texto = String(error || '').trim();
  const nombre = String(nombreEmpleado || '').trim();

  const prefijoNombre = nombre ? `${nombre}: ` : '';
  const matchCon = texto.match(/^Error con\s+(.+?):\s*(.+)$/i);
  const empleado = matchCon?.[1]?.trim() || nombre;
  const detalle = matchCon?.[2]?.trim() || texto;

  const mensajeTraducido = traducirMensajeError(detalle);
  const etiqueta = empleado || nombre;

  return etiqueta ? `${etiqueta}: ${mensajeTraducido}` : mensajeTraducido;
}

/** Traduce una lista de errores y elimina duplicados. */
export function traducirErroresLista(errores: string[]): string[] {
  const traducidos = errores
    .map((error) => traducirErrorRegistroEmpleado(error))
    .filter((error) => error.length > 0);

  return [...new Set(traducidos)];
}

export interface FilaDescartadaExcel {
  numeroFila: number;
  motivo: string;
  detalle?: string;
}

/** Genera HTML con el detalle de filas descartadas en la importación de Excel. */
export function construirHtmlFilasDescartadasExcel(
  filas: FilaDescartadaExcel[],
  maxVisible = 12
): string {
  if (!filas.length) {
    return '';
  }

  const visibles = filas.slice(0, maxVisible);
  const restantes = filas.length - visibles.length;

  const items = visibles.map((fila) => {
    const detalle = fila.detalle ? ` <span style="color:#8898aa;">(${fila.detalle})</span>` : '';
    return `<li style="margin-bottom:0.25rem;">Fila <strong>${fila.numeroFila}</strong>: ${fila.motivo}${detalle}</li>`;
  }).join('');

  const extra = restantes > 0
    ? `<li style="margin-top:0.35rem; color:#8898aa;">…y ${restantes} fila(s) más con problemas similares.</li>`
    : '';

  return `
    <div style="margin-top:0.5rem; margin-bottom:0.35rem; color:#fb6340;">
      <strong>${filas.length} fila(s) se descartaron:</strong>
      <ul style="margin:0.4rem 0 0 1.1rem; padding:0; font-size:0.9rem; max-height:180px; overflow-y:auto;">
        ${items}${extra}
      </ul>
    </div>
  `;
}

/** Genera HTML para mostrar errores de registro en alertas. */
export function construirHtmlErroresRegistro(errores: string[], titulo = 'Empleados no registrados'): string {
  const traducidos = traducirErroresLista(errores);
  if (!traducidos.length) {
    return '';
  }

  const items = traducidos.map((error) => `<li style="margin-bottom:0.25rem;">${error}</li>`).join('');

  return `
    <div style="margin-top:0.5rem; text-align:left; color:#fb6340; font-size:0.9rem;">
      <strong>${titulo}:</strong>
      <ul style="margin:0.4rem 0 0 1.1rem; padding:0; max-height:200px; overflow-y:auto;">
        ${items}
      </ul>
    </div>
  `;
}
