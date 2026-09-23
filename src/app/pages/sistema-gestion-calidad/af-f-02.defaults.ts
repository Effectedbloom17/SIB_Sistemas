/** Textos por defecto AF-F-02 Contrato (plantilla Word / Google Doc Sistema). */

export interface AfF02CamposVariables {
  clienteNombre: string;
  clienteRepresentanteIntro: string;
  clienteConstitucion: string;
  clienteRfc: string;
  clienteObjeto: string;
  clienteRepresentanteLegal: string;
  clienteDomicilio: string;
  codigoProyecto: string;
  fechaFinVigencia: string;
  montoMensual: string;
  montoMensualTexto: string;
  codigoCotizacion: string;
  diaFirma: string;
  anioFirma: string;
  pieCliente: string;
  pieFecha: string;
}

export const AF_F02_CAMPOS_DEFECTO: AfF02CamposVariables = {
  clienteNombre: '',
  clienteRepresentanteIntro: '',
  clienteConstitucion: '',
  clienteRfc: '',
  clienteObjeto: '',
  clienteRepresentanteLegal: '',
  clienteDomicilio: '',
  codigoProyecto: '',
  fechaFinVigencia: '',
  montoMensual: '',
  montoMensualTexto: '',
  codigoCotizacion: '',
  diaFirma: '',
  anioFirma: '',
  pieCliente: '',
  pieFecha: ''
};

export interface AfF02CampoGrupoItem {
  key: keyof AfF02CamposVariables;
  label: string;
  hint?: string;
  /**
   * Restricción de captura:
   * - text: libre
   * - fecha: fecha en texto (día mes año)
   * - fechaPie: solo 12/enero/2026
   * - monto: solo cifra (dígitos, punto/coma)
   * - montoLetra: solo letras/espacios
   * - dia: 1–31
   * - anio: 4 dígitos
   */
  tipo?: 'text' | 'fecha' | 'fechaPie' | 'monto' | 'montoLetra' | 'dia' | 'anio';
}

export interface AfF02CampoGrupo {
  id: string;
  titulo: string;
  campos: AfF02CampoGrupoItem[];
}

/** Agrupa los marcadores xxx por apartado del contrato (UI de edición). */
export const AF_F02_CAMPOS_GRUPOS: AfF02CampoGrupo[] = [
  {
    id: 'intro',
    titulo: 'Introducción',
    campos: [
      {
        key: 'clienteNombre',
        label: 'Cliente (razón social)',
        hint: 'Nombre o razón social completa de la empresa cliente (ej. ACME S.A. de C.V.). Aparece al inicio: “por una parte ___”.'
      },
      {
        key: 'clienteRepresentanteIntro',
        label: 'Representante legal',
        hint: 'Nombre de quien firma por el cliente en este acto. Aparece en: “representada en este acto por ___”.'
      }
    ]
  },
  {
    id: 'declaraciones',
    titulo: 'Declaraciones',
    campos: [
      {
        key: 'clienteConstitucion',
        label: '1.1 · Acreditación / constitución',
        hint: 'Datos con los que se acredita la constitución legal (escritura, póliza, etc.). Completa: “…acreditado ___”.'
      },
      {
        key: 'clienteRfc',
        label: '1.2 · RFC del cliente',
        hint: 'RFC del cliente ante el SAT (12 o 13 caracteres). Completa: “…Registro Federal de Contribuyentes ___”.'
      },
      {
        key: 'clienteObjeto',
        label: '1.3 · Objeto social',
        hint: 'Actividad u objeto social de la empresa cliente según sus estatutos. Completa: “…tiene por objeto ___”.'
      },
      {
        key: 'clienteRepresentanteLegal',
        label: '1.4 · Representante legal',
        hint: 'Nombre completo del representante legal declarado en el contrato. Completa: “…su representante legal es ___”.'
      },
      {
        key: 'clienteDomicilio',
        label: 'i.4 · Domicilio legal',
        hint: 'Domicilio legal completo del cliente (calle, colonia, ciudad, C.P.). Completa: “…ubicado en ___”.'
      }
    ]
  },
  {
    id: 'clausulas',
    titulo: 'Cláusulas',
    campos: [
      {
        key: 'codigoProyecto',
        label: 'Primera · Código de proyecto',
        hint: 'Código interno del proyecto en Biznaga (nomenclatura del prestador). Completa: “…proyecto con código ___”.',
        tipo: 'text'
      },
      {
        key: 'fechaFinVigencia',
        label: 'Tercera · Fin de vigencia',
        hint: 'Solo día, mes y año (barras fijas). Ej. 12 / enero / 2026.',
        tipo: 'fechaPie'
      },
      {
        key: 'montoMensual',
        label: 'Cuarta · Monto mensual ($)',
        hint: 'Cantidad numérica del pago mensual sin IVA (solo cifra). Completa: “…cantidad mensual de $___”.',
        tipo: 'monto'
      },
      {
        key: 'montoMensualTexto',
        label: 'Cuarta · Monto en letra',
        hint: 'El mismo monto escrito con letra (ej. quince mil). Completa: “$(cantidad) (___ pesos 00/100 m.n.)”.',
        tipo: 'montoLetra'
      },
      {
        key: 'codigoCotizacion',
        label: 'Cuarta · Cotización B-SC-',
        hint: 'Folio o número de la cotización B-SC asociada. Completa: “…cotización B-SC-___”.',
        tipo: 'text'
      }
    ]
  },
  {
    id: 'cierre',
    titulo: 'Cierre',
    campos: [
      {
        key: 'diaFirma',
        label: 'Día de firma',
        hint: 'Día del mes en que se firma el contrato (número del 1 al 31). Completa: “…el día ___ de octubre”.',
        tipo: 'dia'
      },
      {
        key: 'anioFirma',
        label: 'Año de firma',
        hint: 'Año de la firma (cuatro dígitos). Completa: “…del año ___”.',
        tipo: 'anio'
      }
    ]
  },
  {
    id: 'pie',
    titulo: 'Pie de firmas',
    campos: [
      {
        key: 'pieCliente',
        label: 'Cliente',
        hint: 'Razón social del cliente en el pie de firmas (puede coincidir con la introducción). Completa: “…celebrado entre “___” y…”.',
        tipo: 'text'
      },
      {
        key: 'pieFecha',
        label: 'Fecha',
        hint: 'Solo día, mes y año (barras fijas). Ej. 12 / enero / 2026.',
        tipo: 'fechaPie'
      }
    ]
  }
];

/** Filtra el valor según el tipo de campo (fechas / montos / día / año). */
export function filtrarValorCampoAfF02(
  tipo: AfF02CampoGrupoItem['tipo'] | undefined,
  valor: string
): string {
  const raw = String(valor ?? '');
  switch (tipo) {
    case 'monto':
      return raw.replace(/[^\d.,]/g, '');
    case 'montoLetra':
      return raw.replace(/[^a-zA-ZáéíóúÁÉÍÓÚñÑüÜ\s]/g, '');
    case 'dia': {
      const digits = raw.replace(/\D/g, '').slice(0, 2);
      if (!digits) return '';
      const n = parseInt(digits, 10);
      if (!Number.isFinite(n) || n <= 0) return '';
      if (n > 31) return '31';
      return String(n);
    }
    case 'anio':
      return raw.replace(/\D/g, '').slice(0, 4);
    case 'fecha':
      // Solo fecha en texto: números, letras, espacios y separadores comunes.
      return raw.replace(/[^0-9a-zA-ZáéíóúÁÉÍÓÚñÑüÜ\s./-]/g, '');
    case 'fechaPie': {
      // Solo 12/enero/2026 (dígitos, letras de mes y /)
      let t = raw.replace(/[^0-9a-zA-ZáéíóúÁÉÍÓÚñÑüÜ/]/g, '');
      // Evitar más de 2 barras
      const partes = t.split('/');
      if (partes.length > 3) {
        t = partes.slice(0, 3).join('/');
      }
      // Limitar longitud razonable
      return t.slice(0, 24);
    }
    default:
      return raw;
  }
}

/** ¿La tecla es válida para el tipo de campo? */
export function teclaPermitidaCampoAfF02(
  tipo: AfF02CampoGrupoItem['tipo'] | undefined,
  key: string
): boolean {
  if (!tipo || tipo === 'text') return true;
  if (key.length !== 1) return true;
  switch (tipo) {
    case 'monto':
      return /[0-9.,]/.test(key);
    case 'montoLetra':
      return /[a-zA-ZáéíóúÁÉÍÓÚñÑüÜ\s]/.test(key);
    case 'dia':
    case 'anio':
      return /[0-9]/.test(key);
    case 'fecha':
      return /[0-9a-zA-ZáéíóúÁÉÍÓÚñÑüÜ\s./-]/.test(key);
    case 'fechaPie':
      return /[0-9a-zA-ZáéíóúÁÉÍÓÚñÑüÜ/]/.test(key);
    default:
      return true;
  }
}

export function esCampoRestringidoAfF02(tipo: AfF02CampoGrupoItem['tipo'] | undefined): boolean {
  return tipo === 'monto' || tipo === 'montoLetra' || tipo === 'dia' || tipo === 'anio'
    || tipo === 'fecha' || tipo === 'fechaPie';
}

const MESES_PIE: Record<string, string> = {
  '1': 'enero', '01': 'enero', enero: 'enero',
  '2': 'febrero', '02': 'febrero', febrero: 'febrero',
  '3': 'marzo', '03': 'marzo', marzo: 'marzo',
  '4': 'abril', '04': 'abril', abril: 'abril',
  '5': 'mayo', '05': 'mayo', mayo: 'mayo',
  '6': 'junio', '06': 'junio', junio: 'junio',
  '7': 'julio', '07': 'julio', julio: 'julio',
  '8': 'agosto', '08': 'agosto', agosto: 'agosto',
  '9': 'septiembre', '09': 'septiembre', septiembre: 'septiembre',
  '10': 'octubre', octubre: 'octubre',
  '11': 'noviembre', noviembre: 'noviembre',
  '12': 'diciembre', diciembre: 'diciembre'
};

/** 12/enero/2026 → 12 de enero de 2026 (texto del contrato). */
export function formatearPieFechaAfF02(pieFecha: string): string {
  const raw = String(pieFecha || '').trim();
  if (!raw || /^x+\/x+\/x+$/i.test(raw)) return '';
  const m = raw.match(/^(\d{1,2})\s*[\/\-]\s*([a-záéíóúñÁÉÍÓÚÑ]+|\d{1,2})\s*[\/\-]\s*(\d{2,4})$/i);
  if (m) {
    const dia = String(parseInt(m[1], 10));
    const mesKey = m[2].toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    const mes = MESES_PIE[mesKey] || MESES_PIE[m[2].toLowerCase()] || m[2].toLowerCase();
    let anio = m[3];
    if (anio.length === 2) anio = `20${anio}`;
    return `${dia} de ${mes} de ${anio}`;
  }
  if (/\d{1,2}\s+de\s+[a-záéíóúñ]+\s+de\s+\d{4}/i.test(raw)) return raw;
  return raw;
}

export interface AfF02PieFechaPartes {
  dia: string;
  mes: string;
  anio: string;
}

/** Separa 12/enero/2026 (o placeholders xx) en partes para la UI con barras fijas. */
export function parsePieFechaAfF02(pieFecha: string): AfF02PieFechaPartes {
  const raw = String(pieFecha || '').trim();
  const m = raw.match(/^([^/]*)\/([^/]*)\/([^/]*)$/);
  if (!m) {
    return { dia: '', mes: '', anio: '' };
  }
  const limpiaPh = (s: string): string => {
    const t = String(s || '').trim();
    if (!t || /^x+$/i.test(t)) return '';
    return t;
  };
  return {
    dia: limpiaPh(m[1]),
    mes: limpiaPh(m[2]),
    anio: limpiaPh(m[3])
  };
}

export function unirPieFechaAfF02(partes: AfF02PieFechaPartes): string {
  const dia = String(partes?.dia || '').trim();
  const mes = String(partes?.mes || '').trim();
  const anio = String(partes?.anio || '').trim();
  if (!dia && !mes && !anio) return '';
  return `${dia || 'xx'}/${mes || 'xx'}/${anio || 'xxxx'}`;
}

export const AF_F02_DATOS_DEFECTO = {
  empresa: 'BIZNAGA RISK AND TECH',
  fechaElaboracion: '2024-09-18',
  revision: '00',
  intro:
    'Contrato de prestación de servicios que celebran por una parte xxx. representada en este acto por xx ,en su calidad de representante legal, a quien en lo sucesivo se le denominará "el cliente" y por la otra, Biznaga Risk and Tech S. de R.L. de C.V., en lo sucesivo “el prestador de servicios", y de manera conjunta se denominarán “las partes”, al tenor de las siguientes:',
  declaraciones:
    'Declaraciones\n'
    + '1. Declara  "el cliente”:\n'
    + '1.1.        Que es una empresa legalmente constituida y organizada conforme a las leyes y disposiciones de los Estados Unidos Mexicanos, acreditado xxx\n'
    + '1.2.        Que se encuentra dada de alta ante el Servicio de Administración Tributaria con la clave de Registro Federal de Contribuyentes xxxxx\n'
    + '1.3.        Que tiene por objeto xxxxx\n'
    + '1.4.        Que su representante legal es xxxx, quien tiene la capacidad legal para suscribir contratos, convenios y otros instrumentos jurídicos.\n'
    + 'i.4.        Que para efectos del presente contrato señala como su domicilio legal el ubicado en xxxxx\n'
    + '2. Declara “el prestador de servicios":\n'
    + '2.1.        Que es una empresa legalmente constituida en el Estado de Hidalgo de conformidad con el Acta Notarial con número de póliza 1960 de la Correduría Pública no. 7.\n'
    + '2.2.        Que tiene por objeto la consultoría en la implementación de sistemas de calidad, seguridad e higiene industrial y medicina laboral, así como en materia ambiental, capacitación, entre otros\n'
    + '2.3.        Que se encuentra dada de alta ante el Servicio de Administración Tributaria con la clave de Registro Federal de Contribuyentes BRT1702204Z5.\n'
    + '2.4.        Que su representante legal es Marisol Azucena Santillán Melo, en términos de la cláusula transitoria segunda del instrumento público 1388 de la Correduría Pública número 7, encontrándose dentro de sus facultades las de suscribir contratos, convenios y otros acuerdos necesarios para el cumplimiento de los objetivos de la persona moral que representa.\n'
    + '2.5.        Que para efectos del presente contrato señala como su domicilio legal el ubicado en Monte Olivo 111, Fraccionamiento Real de la Loma, Pachuca, Hidalgo, con C.P. 42083.\n'
    + '3. Declaran “las partes”:\n'
    + 'Único.- Que se reconocen la personalidad jurídica que ostentan y que es su voluntad suscribir el presente instrumento privado en los términos y condiciones insertos en las siguientes:',
  clausulas:
    'Cláusulas\n'
    + 'Primera. Del objeto del contrato.- “El prestador  de servicios" se obliga a implementar un programa de seguridad y salud en el trabajo para “el cliente”. La denominación de dicho proyecto se identificará con la nomenclatura interna del “prestador de servicios”,  proyecto con código xxxx cuyas características se encuentran especificadas en el “Control de Avance de Proyecto, Cumplimiento Normativa STPS”, [Anexo I].\n'
    + 'Segunda. De las condiciones del proyecto.- La implementación del proyecto tendrá una duración de un año y su objetivo específico es desarrollar y aplicar los controles, procedimientos, programas, diagnosticos y en general todas las disposiciones contenidas en las siguiente Normas Oficiales Mexicanas:\n'
    + '1. "NOM-001-STPS-2008 Edificios, locales, instalaciones y áreas en los centros de trabajo  Condiciones de seguridad.\n'
    + '2. NOM-002-STPS-2010 Prevención y protección contra incendios en los centros de trabajo Condiciones de seguridad.\n'
    + '3. "NOM-004-STPS-1999  Sistemas de protección y dispositivos de seguridad en la maquinaria y equipo que se utilice en los centros de trabajo"\n'
    + '4. " NOM-006-STPS-2014,  Manejo y almacenamiento de materiales Condiciones de seguridad y salud en el trabajo.\n'
    + '5. NOM 005 Relativa a las condiciones de seguridad e higiene, en los centros de trabajo para el manejo, transporte y almacenamiento de sustancias químicas peligrosas\n'
    + '6. NOM-017-STPS-2008  Equipo de protección personal, Selección, uso y manejo en los centros de trabajo\n'
    + '7. "NOM-018-STPS-2015, Sistema armonizado para la identificación y comunicación de peligros y riesgos por sustancias químicas peligrosas en los centros de trabajo\n'
    + '8. "NOM-019-STPS-2011 Constitución, integración, organización y funcionamiento de las comisiones de seguridad e higiene en los centros de trabajo\n'
    + '9. " NOM-020-STPS-2011  Recipientes sujetos a presión, recipientes criogénicos y generadores de vapor o calderas.- Funcionamiento Condiciones de seguridad\n'
    + '10. " NOM-022-STPS-2008 Electricidad estática en los centros de trabajo Condiciones de seguridad.\n'
    + '11. NOM-025-STPS-2008 Condiciones de iluminación en los centros de trabajo\n'
    + '12. NOM-026-STPS-2008  Colores y señales de seguridad e higiene, e identificación de riesgos por fluidos conducidos en tubería\n'
    + '13. NOM-029-STPS-2011, Mantenimiento de las instalaciones eléctricas en los centros de trabajo-Condiciones de seguridad.\n'
    + '14. "NOM-030-STPS-2009, Servicios preventivos de seguridad y salud en el trabajo- Funciones y actividades.\n'
    + '15. "NORMA Oficial Mexicana NOM-036-1-STPS-2018, Factores de riesgo ergonómico en el Trabajo-Identificación, análisis, prevención y control. Parte 1: Manejo manual de cargas.\n'
    + 'El avance y entregas del proyecto se realizarán de conformidad a la programación especificada en el formato interno del "prestador  de servicios", denominado “control de proyecto código SP-F-05”, mismo que se anexa al presente instrumento jurídico en dos tantos firmados en original por las partes, [Anexo II].\n'
    + 'Tercera. De la vigencia.- El presente contrato comenzará su vigencia y surtirá sus efectos a partir de la fecha de su suscripción. Terminando sus efectos el 2 de octubre de 2024.\n'
    + 'Cuarta. Del pago- Como contraprestación del servicio, “el cliente” se obliga a pagar la cantidad mensual de $xxx (xxx pesos 00/100 m.n.) sin IVA, de conformidad con la cotización B-SC-xxx [Anexo III].\n'
    + 'El “prestador de servicios” se obliga a aportar al “cliente” la documentación mensual que contenga el avance de la implementación del proyecto objeto del presente contrato, de acuerdo a la programación establecida en el Anexo II. Dicha documentación deberá entregarse los días 21 de cada mes en el domicilio del “cliente”.\n'
    + 'El pago deberá efectuarse en su totalidad, cuando “el prestador de servicios” cumpla con lo pactado en el párrafo inmediato anterior.\n'
    + 'Quinta. De la forma de pago.- La cantidad enunciada en la cláusula “Tercera” de este instrumento jurídico, deberá ser pagada en moneda nacional, mediante transferencia electrónica.\n'
    + '"El cliente" realizará dicha operación a la cuenta 04704412648 del Banco Scotiabank con CLABE interbancaria 044290047044126481, misma que pertenece al "prestador de servicios".\n'
    + '“El prestador de servicios” expedirá los documentos fiscales digitales correspondientes de cada una de las operaciones financieras realizadas durante la vigencia del contrato.\n'
    + 'Sexta. De la pena convencional.- Si “el prestador de servicios” no entrega la documentación a la que se hizo referencia en el párrafo segundo de la cláusula “Tercera”, dentro del plazo establecido para tal efecto, se impondrá una pena convencional equivalente al 5% por cada día de retraso, sobre el importe de la contraprestación señalada en la cláusula “Tercera”; siendo este porcentaje acumulable hasta que “el prestador de servicios” cumpla con la obligación pactada.\n'
    + 'Séptima. Del acceso a instalaciones e información.- "El cliente" se obliga a proporcionar al "prestador de servicios" todos los elementos e información necesarios para la implementación del programa de seguridad y salud en el trabajo, así como cualquier otra actividad esencial para la eficiente prestación de los servicios contratados en este instrumento.\n'
    + 'Octava. De las causales de rescisión.- "El cliente" podrá rescindir el presente contrato sin responsabilidad, en los siguientes supuestos:\n'
    + '1. Cuando “el prestador de servicios” suspenda injustificadamente la ejecución de los servicios sin previo aviso y acuerdo entre “las partes”.\n'
    + '2. En caso de incumplimiento de las obligaciones pactadas dentro del cuerpo del presente contrato por parte del “prestador de servicios”.\n'
    + '"El cliente” deberá notificar por escrito o cualquier medio con soporte electrónico al “prestador de servicios”, por lo menos 15 días hábiles anteriores, a partir del día en que se pretenda rescindir éste instrumento jurídico.\n'
    + 'Novena. De la terminación del contrato.- El presente contrato de prestación de servicios terminará por alguna de las siguientes causas:\n'
    + '1. La consecución del objeto del presente contrato.\n'
    + '2. La imposibilidad material de seguir prestando el servicio jurídico.\n'
    + '3. El mutuo consentimiento de “las partes”.\n'
    + 'Décima.- De la novación.- Bajo ninguna circunstancia se entenderán por novadas las obligaciones contraídas dentro del presente contrato de forma tácita o por el simple paso del tiempo. Por lo que al término de su vigencia, “las partes” deberán suscribir un nuevo instrumento, si así conviene a sus intereses.\n'
    + 'Décimo primera.  De la naturaleza jurídica de la relación contractual.- “El prestador de servicios" conviene y acepta que en atención al origen del presente contrato, no se derivan de él, en ningún caso, relaciones jurídicas de carácter permanente.\n'
    + 'Las partes reconocen que el presente contrato constituye un instrumento meramente civil, y en ningún caso, implica una relación laboral o de cualquier otra naturaleza.\n'
    + 'Décimo segunda. Confidencialidad.- “El prestador de servicios” se comprometen a guardar confidencialidad respecto de cualquier tipo de documentación, información o oficio que se genere o intercambie con motivo de la ejecución de las actividades objeto del presente contrato de prestación de servicios,  que se sujetarán en lo que les resulte aplicable a la Ley General de Transparencia y Acceso a la Información Pública, Ley General de Protección de Datos Personales en Posesión de Particulares, Ley Federal de Transparencia y Acceso a la Información Pública y demás normativa en materia de confidencialidad.\n'
    + 'De igual forma, “el prestador de servicios” se obliga a no divulgar, poner a disposición o utilizar en beneficio de cualquier persona física o moral diferente del “cliente”, cualquier información confidencial sin el previo consentimiento por escrito de este.\n'
    + 'Décimo tercera. Incumplimiento por caso fortuito o causas de fuerza mayor.- El incumplimiento de cualquiera de las cláusulas de este contrato por un caso fortuito o causas de fuerza mayor, no será motivo de responsabilidad contractual para ninguna de “las partes”, y ambas tendrán derecho a suspender las obligaciones contenidas en este instrumento civil, previa notificación por escrito con 15 días hábiles de anticipación.\n'
    + 'Décimo cuarta. Jurisdicción.- En caso de interpretación y/o controversia, “las partes” acuerdan someterse a los tribunales competentes del fuero común del distrito judicial de Pachuca de Soto, Hidalgo, renunciando expresamente a cualquiera que les pueda corresponder por razón de cualquier presupuesto procesal de competencia.',
  cierre:
    'Leído que fue el presente contrato y enteradas “las partes” de su contenido y alcance legal, manifiestan su conformidad y lo firman por duplicado, de común acuerdo en Pachuca de Soto, Hidalgo, el día xx de octubre  del año xxx',
  /** Nombre del cliente en firmas: vacío (firma a mano). */
  clienteFirmante: '',
  cargoClienteFirmante: 'Representante legal',
  firmante: 'Marisol Azucena Santillán Melo',
  cargoFirmante: 'Representante legal',
  pieFirmas:
    'Las presentes firmas corresponden al contrato de prestación de servicios para la implementación de un programa de seguridad y salud en el trabajo, celebrado entre “xxxx.” y  “Biznaga Risk and Tech S. de R.L. de C.V.”, el  xx octubre de xx,  suscrito en Pachuca, Hidalgo.',
  campos: { ...AF_F02_CAMPOS_DEFECTO },
  pdfFirmado: null as null
};

function reemplazarUnaVez(texto: string, buscado: string, nuevo: string): string {
  const t = String(texto || '');
  const i = t.indexOf(buscado);
  if (i < 0) {
    return t;
  }
  return t.slice(0, i) + nuevo + t.slice(i + buscado.length);
}

function normalizarCamposAfF02(camposRaw?: Partial<AfF02CamposVariables> | null): AfF02CamposVariables {
  const c: AfF02CamposVariables = { ...AF_F02_CAMPOS_DEFECTO, ...(camposRaw || {}) };
  for (const key of Object.keys(AF_F02_CAMPOS_DEFECTO) as (keyof AfF02CamposVariables)[]) {
    const val = String(c[key] ?? '').trim();
    c[key] = val || AF_F02_CAMPOS_DEFECTO[key];
  }
  return c;
}

const AF_F02_HL_OPEN = '⟦AFHL⟧';
const AF_F02_HL_CLOSE = '⟦/AFHL⟧';

function marcarValorAfF02(valor: string): string {
  return `${AF_F02_HL_OPEN}${valor}${AF_F02_HL_CLOSE}`;
}

function escaparHtmlAfF02(texto: string): string {
  return String(texto || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function textoAHtmlResaltadoAfF02(texto: string): string {
  // Estilos inline: el HTML de innerHTML no recibe atributos de encapsulación de Angular.
  const openTag =
    '<strong class="af-f02-hl" style="color:#1d4ed8 !important;font-weight:700 !important;'
    + 'background:rgba(37,99,235,0.10);padding:0 0.15em;border-radius:2px;">';
  return escaparHtmlAfF02(texto)
    .replace(/\r\n/g, '\n')
    .replace(/\n/g, '<br>')
    .split(AF_F02_HL_OPEN).join(openTag)
    .split(AF_F02_HL_CLOSE).join('</strong>');
}

function aplicarCamposAfF02Interno(
  secciones: {
    intro?: string;
    declaraciones?: string;
    clausulas?: string;
    cierre?: string;
    pieFirmas?: string;
  },
  camposRaw: Partial<AfF02CamposVariables> | null | undefined,
  resaltar: boolean
): {
  intro: string;
  declaraciones: string;
  clausulas: string;
  cierre: string;
  pieFirmas: string;
} {
  const c = normalizarCamposAfF02(camposRaw);
  const v = (valor: string) => (resaltar ? marcarValorAfF02(valor) : valor);

  let intro = String(secciones.intro ?? AF_F02_DATOS_DEFECTO.intro);
  intro = reemplazarUnaVez(intro, 'por una parte xxx.', `por una parte ${v(c.clienteNombre)}`);
  intro = reemplazarUnaVez(
    intro,
    'por xx ,en su calidad',
    `por ${v(c.clienteRepresentanteIntro)} ,en su calidad`
  );

  let declaraciones = String(secciones.declaraciones ?? AF_F02_DATOS_DEFECTO.declaraciones);
  declaraciones = reemplazarUnaVez(
    declaraciones,
    'acreditado xxx',
    `acreditado ${v(c.clienteConstitucion)}`
  );
  declaraciones = reemplazarUnaVez(
    declaraciones,
    'Contribuyentes xxxxx',
    `Contribuyentes ${v(c.clienteRfc)}`
  );
  declaraciones = reemplazarUnaVez(
    declaraciones,
    'por objeto xxxxx',
    `por objeto ${v(c.clienteObjeto)}`
  );
  declaraciones = reemplazarUnaVez(
    declaraciones,
    'legal es xxxx,',
    `legal es ${v(c.clienteRepresentanteLegal)},`
  );
  declaraciones = reemplazarUnaVez(
    declaraciones,
    'ubicado en xxxxx',
    `ubicado en ${v(c.clienteDomicilio)}`
  );

  let clausulas = String(secciones.clausulas ?? AF_F02_DATOS_DEFECTO.clausulas);
  clausulas = reemplazarUnaVez(
    clausulas,
    'código xxxx cuyas',
    `código ${v(c.codigoProyecto)} cuyas`
  );
  clausulas = reemplazarUnaVez(
    clausulas,
    'efectos el 2 de octubre de 2024.',
    `efectos el ${v(formatearPieFechaAfF02(c.fechaFinVigencia) || c.fechaFinVigencia)}.`
  );
  clausulas = reemplazarUnaVez(
    clausulas,
    'mensual de $xxx (xxx pesos',
    `mensual de $${v(c.montoMensual)} (${v(c.montoMensualTexto)} pesos`
  );
  clausulas = reemplazarUnaVez(
    clausulas,
    'cotización B-SC-xxx ',
    `cotización B-SC-${v(c.codigoCotizacion)} `
  );

  let cierre = String(secciones.cierre ?? AF_F02_DATOS_DEFECTO.cierre);
  cierre = reemplazarUnaVez(cierre, 'el día xx de octubre', `el día ${v(c.diaFirma)} de octubre`);
  cierre = reemplazarUnaVez(cierre, 'del año xxx', `del año ${v(c.anioFirma)}`);

  let pieFirmas = String(secciones.pieFirmas ?? AF_F02_DATOS_DEFECTO.pieFirmas);
  pieFirmas = reemplazarUnaVez(pieFirmas, 'entre “xxxx.” y', `entre “${v(c.pieCliente)}” y`);
  const pieFechaDoc = formatearPieFechaAfF02(c.pieFecha);
  pieFirmas = reemplazarUnaVez(pieFirmas, 'el  xx octubre de xx,', `el  ${v(pieFechaDoc)},`);
  pieFirmas = reemplazarUnaVez(pieFirmas, 'el xx octubre de xx,', `el ${v(pieFechaDoc)},`);

  return { intro, declaraciones, clausulas, cierre, pieFirmas };
}

/** Sustituye los marcadores xxx de la plantilla base con los valores de campos. */
export function aplicarCamposAfF02(
  secciones: {
    intro?: string;
    declaraciones?: string;
    clausulas?: string;
    cierre?: string;
    pieFirmas?: string;
  },
  camposRaw?: Partial<AfF02CamposVariables> | null
): {
  intro: string;
  declaraciones: string;
  clausulas: string;
  cierre: string;
  pieFirmas: string;
} {
  return aplicarCamposAfF02Interno(secciones, camposRaw, false);
}

/** Igual que aplicarCamposAfF02, pero con valores resaltados en HTML (azul / negrita). */
export function aplicarCamposAfF02Html(
  secciones: {
    intro?: string;
    declaraciones?: string;
    clausulas?: string;
    cierre?: string;
    pieFirmas?: string;
  },
  camposRaw?: Partial<AfF02CamposVariables> | null
): {
  intro: string;
  declaraciones: string;
  clausulas: string;
  cierre: string;
  pieFirmas: string;
} {
  const plain = aplicarCamposAfF02Interno(secciones, camposRaw, true);
  return {
    intro: textoAHtmlResaltadoAfF02(plain.intro),
    declaraciones: textoAHtmlResaltadoAfF02(plain.declaraciones),
    clausulas: textoAHtmlResaltadoAfF02(plain.clausulas),
    cierre: textoAHtmlResaltadoAfF02(plain.cierre),
    pieFirmas: textoAHtmlResaltadoAfF02(plain.pieFirmas)
  };
}
