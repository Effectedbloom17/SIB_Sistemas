export interface DgF07ProcesoDef {
  slug: string;
  etiqueta: string;
  nombreProceso: string;
  responsable: string;
  objetivo: string;
  procesoAnterior: string;
  procesoSiguiente: string;
  entradas: string[];
  salidas: string[];
  recursos: string;
  criteriosMetodos: string;
  indicadores: string;
}

export const DG_F07_PROCESOS: DgF07ProcesoDef[] = [
  {
    "slug": "planeacion-estrategica",
    "etiqueta": "Planeación estratégica",
    "nombreProceso": "PLANEACIÓN ESTRATÉGICA",
    "responsable": "Alta Dirección",
    "objetivo": "Llevar a cababo la planeación estratégica de la organización, para la toma de decisiones.",
    "procesoAnterior": "MEJORA CONTINUA",
    "procesoSiguiente": "GESTIÓN DE CALIDAD",
    "entradas": [
      "Análisis del contexto de la orgnaización.",
      "Establecer e implementar una política de calidad.",
      "Determinar de los objetivos de calidad.",
      "Determinación de los procesos para el SGC."
    ],
    "salidas": [
      "FODA, Lista de partes interesadas, alcance del",
      "SGC, Política y objetivos del SGC, mapa de",
      "procesos, entradas y salidas de procesos,",
      "procedimientos."
    ],
    "recursos": "Tiempo / Humano",
    "criteriosMetodos": "Se especifican en los documentos de salida.",
    "indicadores": "Se especifican en el Cuadro de mando para objetivos de calidad e indicadores."
  },
  {
    "slug": "liderazgo",
    "etiqueta": "Liderazgo",
    "nombreProceso": "LIDERAZGO",
    "responsable": "Alta Dirección",
    "objetivo": "Mostrar liderazgo y compromiso con respecto al SGC.",
    "procesoAnterior": "NINGUNO",
    "procesoSiguiente": "GESTIÓN DE CALIDAD",
    "entradas": [
      "Rendición de cuentas de la eficacia del SGC.",
      "Política y objetivos de calidad.",
      "Recursos necesarios para el SGC.",
      "Enfoque a procesos y pensamiento basado en riesgos.",
      "Comunicando la importancia de una gestión de la calidad eficaz.",
      "Comprometiendo, dirigiendo y apoyando a las personas, para contribuir a la eficacia del SGC.",
      "Apoyando otros roles pertinentes de la dirección, para demostrar su liderazgo.",
      "Asegurándose de que el SGC logre los resultados previstos.",
      "Promoviendo la mejora."
    ],
    "salidas": [
      "Un sistema de gestión de calidad enfocado a la mejora de la organización."
    ],
    "recursos": "",
    "criteriosMetodos": "",
    "indicadores": ""
  },
  {
    "slug": "seg-med-an-y-eval",
    "etiqueta": "Seguimiento, medición, análisis y evaluación",
    "nombreProceso": "SEGUIMIENTO, MEDICIÓN, ANÁLISIS Y EVALUACIÓN",
    "responsable": "Alta Dirección",
    "objetivo": "Dar seguimiento y medición a los procesos para su posterior análisis y evaluación.",
    "procesoAnterior": "PLANEACIÓN ESTRATÉGICA / LIDERAZGO",
    "procesoSiguiente": "REVISIÓN POR LA DIRECCIÓN",
    "entradas": [
      "Cuestiones internas y externas",
      "Partes interesadas",
      "Acciones para abordar riesgos y oportunidades",
      "Ambiente laboral",
      "La competencia de los trabajadores",
      "Proyectos de mejora",
      "No conformidades y acciones correctivas",
      "Resultados de las auditorías",
      "Objetivos de calidad e indicadores"
    ],
    "salidas": [
      "Toma de decisiones",
      "Mejora",
      "Mejora continua"
    ],
    "recursos": "",
    "criteriosMetodos": "",
    "indicadores": ""
  },
  {
    "slug": "satisfaccion-del-cliente",
    "etiqueta": "Satisfacción del cliente",
    "nombreProceso": "SATISFACCIÓN DEL CLIENTE",
    "responsable": "Gerente de Ventas",
    "objetivo": "Mantener siempre la satisfacción de nuestros clientes",
    "procesoAnterior": "PLANEACIÓN ESTRATÉGICA / LIDERAZGO",
    "procesoSiguiente": "REVISIÓN POR LA DIRECCIÓN",
    "entradas": [
      "Requisitos del cliente.",
      "Requisitos legales y reglamentarios aplicables.",
      "Riesgos y oportunidades.",
      "Encuestas de satisfacción del cliente",
      "Quejas y sugerencias del cliente"
    ],
    "salidas": [
      "Satisfacción del cliente",
      "Acciones para mejorar la atención al cliente",
      "Atención a quejas y sujerencias"
    ],
    "recursos": "",
    "criteriosMetodos": "",
    "indicadores": ""
  },
  {
    "slug": "auditoria-interna",
    "etiqueta": "Auditoría interna",
    "nombreProceso": "AUDITORÍA INTERNA",
    "responsable": "Coordinador del SGC",
    "objetivo": "Verificar que el SGC es conforme con los requisitos, se implementa y se mantiene eficazmente",
    "procesoAnterior": "PLANEACIÓN ESTRATÉGICA / LIDERAZGO",
    "procesoSiguiente": "REVISIÓN POR LA DIRECCIÓN",
    "entradas": [
      "Evidencia objetiva del seguimiento y medición",
      "Procesos",
      "Competencia de auditores",
      "Programa de auditoría",
      "Plan de auditoría"
    ],
    "salidas": [
      "Resultados de auditoría",
      "Reporte de auditoría"
    ],
    "recursos": "",
    "criteriosMetodos": "",
    "indicadores": ""
  },
  {
    "slug": "nc-y-ac",
    "etiqueta": "No conformidad y acciones correctivas",
    "nombreProceso": "NO CONFORMIDAD Y ACCIONES CORRECTIVAS",
    "responsable": "Coordinador del SGC",
    "objetivo": "Atender las no conformidades que se presenten dentro del SGC y tomar acciones para controlarlas y corregirlas",
    "procesoAnterior": "PLANEACIÓN ESTRATÉGICA / LIDERAZGO",
    "procesoSiguiente": "REVISIÓN POR LA DIRECCIÓN",
    "entradas": [
      "No conformidades",
      "Objetivos e indicadores",
      "Quejas del cliente",
      "Producto / servicio no conforme",
      "Evaluación del ambiente para los procesos",
      "Resultados de las auditorías"
    ],
    "salidas": [
      "Acciones de corrección",
      "Acciones correctivas",
      "Planes de acción"
    ],
    "recursos": "",
    "criteriosMetodos": "",
    "indicadores": ""
  },
  {
    "slug": "revision-por-la-dir",
    "etiqueta": "Revisión por la dirección",
    "nombreProceso": "REV. POR LA DIRECCIÓN",
    "responsable": "Alta Dirección",
    "objetivo": "Revisar el SGC para asegurarse de su conveniencia, adecuación y eficacia",
    "procesoAnterior": "GESTIÓN DE CALIDAD",
    "procesoSiguiente": "MEJORA CONTINUA",
    "entradas": [
      "El estado de las acciones de las revisiones por la dirección previas.",
      "Cambios en las cuestiones internas y externas.",
      "Adecuación de los recursos.",
      "La eficacia de las acciones tomadas para abordar los riesgos y las oportunidades.",
      "Oportunidades de mejora",
      "Satisfacción del cliente y retroalimentación de las partes interesadas pertinentes.",
      "El grado en el que se han cumplido los objetivos de calidad.",
      "El desempeño de los procesos y conformidad de los productos y servicios.",
      "No conformidades y acciones correctivas.",
      "Los resultados del seguimiento y medición",
      "Resultados de las auditorías.",
      "El desempeño de los proveedores externos."
    ],
    "salidas": [
      "Acciones relacionadas con:",
      "Las oportunidades de mejora.",
      "La necesidad de cambios en el SGC.",
      "La necesidad de recursos."
    ],
    "recursos": "",
    "criteriosMetodos": "",
    "indicadores": ""
  },
  {
    "slug": "mejora-continua",
    "etiqueta": "Mejora continua",
    "nombreProceso": "MEJORA CONTINUA",
    "responsable": "Coordinador del SGC",
    "objetivo": "Determinar y seleccionar las oportunidades de mejora para la conveniencia, adecuación y eficacia del SGC.",
    "procesoAnterior": "REVISIÓN POR DIRECCIÓN",
    "procesoSiguiente": "PLANEACIÓN ESTRATÉGICA / LIDERAZGO",
    "entradas": [
      "Necesidad de mejorar algo en el SGC",
      "Revisión por dirección",
      "Acciones para abordar riesgos y oportunidades",
      "No conformidades y acciones correctivas",
      "Resultado de las auditorías"
    ],
    "salidas": [
      "Proyectos de mejora",
      "Planes de acción",
      "Cambios al SGC",
      "Satisfacción del cliente"
    ],
    "recursos": "",
    "criteriosMetodos": "",
    "indicadores": ""
  },
  {
    "slug": "cotizacion",
    "etiqueta": "Cotización",
    "nombreProceso": "COTIZACIÓN",
    "responsable": "Ejecutivo de ventas",
    "objetivo": "Determinar los requisitos del cliente en un documento formal (cotización) para su posterior provisión del servicio.",
    "procesoAnterior": "NINGUNO",
    "procesoSiguiente": "PAGO Y FACTURACIÓN",
    "entradas": [
      "Requisitos del cliente",
      "Requisitos legales y reglamentarios",
      "Precios de los servicios establecidos",
      "Cláusulas de servicio"
    ],
    "salidas": [
      "Registro de Cotización"
    ],
    "recursos": "Tiempo / Formato de cotización / Humano / Computadora o Laptop",
    "criteriosMetodos": "Se especifican en el procedimiento de Cotización, contrato, pago y facturación (ATH-P-03).",
    "indicadores": "Se especifican en el Cuadro de mando para objetivos de calidad e indicadores."
  },
  {
    "slug": "contrato",
    "etiqueta": "Firma de contrato",
    "nombreProceso": "FIRMA DE CONTRATO",
    "responsable": "Dirección General",
    "objetivo": "Determinar los requisitos del cliente en un documento formal (contrato) para su posterior provisión del servicio.",
    "procesoAnterior": "LICITACIÓN / COTIZACIÓN",
    "procesoSiguiente": "PAGO Y FACTURACIÓN",
    "entradas": [
      "Requisitos del cliente",
      "Requisitos legales y reglamentarios",
      "Cotización",
      "Cláusulas de servicio"
    ],
    "salidas": [
      "Registro del contrato"
    ],
    "recursos": "Tiempo / Formato del contrato / Humano / Computadora o Laptop",
    "criteriosMetodos": "Se especifican en el procedimiento de Cotización, contrato, pago y facturación (ATH-P-03).",
    "indicadores": "Se especifican en el Cuadro de mando para objetivos de calidad e indicadores."
  },
  {
    "slug": "pago-y-facturacion",
    "etiqueta": "Pago y facturación",
    "nombreProceso": "PAGO Y FACTURACIÓN",
    "responsable": "Gerente de Administración y Talento Humano",
    "objetivo": "Asegurar el pago de los servicios que ofrecemos y cumplir con los requisitos fiscales y normativos.",
    "procesoAnterior": "COTIZACIÓN / CONTRATO",
    "procesoSiguiente": "PLANEACIÓN",
    "entradas": [
      "Comprobante bancario del pago de servicios",
      "Datos fiscales del cliente"
    ],
    "salidas": [
      "Registro de Factura"
    ],
    "recursos": "Tiempo / Humanos / Tecnológicos",
    "criteriosMetodos": "Se especifican en el procedimiento de Cotización, contrato, pago y facturación (ATH-P-03).",
    "indicadores": "Se especifican en el Cuadro de mando para objetivos de calidad e indicadores."
  },
  {
    "slug": "planeacion",
    "etiqueta": "Planeación",
    "nombreProceso": "PLANEACIÓN",
    "responsable": "Ejecutivos",
    "objetivo": "Planear las actividades que se especificaron en la cotización o contrato para la provisión del servicio.",
    "procesoAnterior": "PAGO Y FACTURACIÓN",
    "procesoSiguiente": "OPERACIÓN",
    "entradas": [
      "Información sobre el servicio que se va a",
      "ofrecer.",
      "Formato SP-F-05"
    ],
    "salidas": [
      "Plan de trabajo (formato SP-F-05)"
    ],
    "recursos": "Tiempo / Humano / Lap-Top",
    "criteriosMetodos": "Se especifican en los procedimientos operativos.",
    "indicadores": "Se especifican en el Cuadro de mando para objetivos de calidad e indicadores."
  },
  {
    "slug": "consul-estrategica",
    "etiqueta": "Consultoría estratégica",
    "nombreProceso": "CONSULTORÍA ESTRATÉGICA",
    "responsable": "Consultores",
    "objetivo": "Ofrecer el servicio de consultoría estratégica, de acuerdo a las necesidades del cliente y los requisitos establecidos en la cotización.",
    "procesoAnterior": "PLANEACIÓN",
    "procesoSiguiente": "NINGUNO",
    "entradas": [
      "Plan de trabajo (formato SP-F-05)"
    ],
    "salidas": [
      "Servicio de consultoría estratégica.",
      "Proyecto o servicio concluido.",
      "Encuesta de satisfacción del cliente."
    ],
    "recursos": "Tiempo / Económicos / Humanos / Tecnológicos",
    "criteriosMetodos": "Se especifican en el procedimiento de Consultoría estratégica (SP-P-01).",
    "indicadores": "Se especifican en el Cuadro de mando para objetivos de calidad e indicadores."
  },
  {
    "slug": "cap-empresarial",
    "etiqueta": "Capacitación empresarial",
    "nombreProceso": "CAPACITACIÓN EMPRESARIAL",
    "responsable": "Ejecutivo de Sistemas de Gestión y Capacitación",
    "objetivo": "Impartir de cursos de formación de capital humano, de manera presencial grupal, por parte de Biznaga a clientes que los requieran.",
    "procesoAnterior": "PLANEACIÓN",
    "procesoSiguiente": "NINGUNO",
    "entradas": [
      "Plan del curso (SP-F-07)",
      "Lista de necesidades para el curso (SP-F-08)"
    ],
    "salidas": [
      "Personal capacitado en un tema específico.",
      "Evaluación del aprendizaje (SP-F-10).",
      "Informe final del curso (SP-F-11)."
    ],
    "recursos": "Tiempo / Económicos / Humanos / Tecnológicos",
    "criteriosMetodos": "Se especifican en el procedimiento de Capacitación empresarial (SP-P-02).",
    "indicadores": "Se especifican en el Cuadro de mando para objetivos de calidad e indicadores."
  },
  {
    "slug": "tramites",
    "etiqueta": "Trámites",
    "nombreProceso": "TRÁMITES",
    "responsable": "Ejecutivos",
    "objetivo": "Ofrecer el servicio de trámites, de acuerdo a las necesidades del cliente y los requisitos establecidos en la cotización.",
    "procesoAnterior": "PLANEACIÓN",
    "procesoSiguiente": "NINGUNO",
    "entradas": [
      "Plan de trabajo (formato SP-F-05)",
      "Listado maestro de info. a solicitar (SP-F-01)"
    ],
    "salidas": [
      "Trámite del cliente realizado",
      "Encuesta de satisfacción del cliente.",
      "Control de entrega de documentos (SP-F-03)"
    ],
    "recursos": "Tiempo / Económicos / Humanos / Tecnológicos",
    "criteriosMetodos": "Se especifican en el procedimiento de Trámites (SP-P-03).",
    "indicadores": "Se especifican en el Cuadro de mando para objetivos de calidad e indicadores."
  },
  {
    "slug": "medicion-tierras-fisicas",
    "etiqueta": "Medición de tierras físicas",
    "nombreProceso": "MEDICIÓN DE TIERRAS FÍSICAS",
    "responsable": "Técnico verificador",
    "objetivo": "Medir la resistencia a tierra de la red de puesta a tierra en los centros de trabajo que así lo soliciten.",
    "procesoAnterior": "PLANEACIÓN",
    "procesoSiguiente": "NINGUNO",
    "entradas": [
      "Reconocimiento de red de puesta a tierra (SP-F-16)",
      "Hoja de campo (SP-F-17)",
      "Información técnica o adicional del cliente.",
      "Normativa aplicable."
    ],
    "salidas": [
      "Resultados de las mediciones.",
      "Cálculos resistencia puesta a tierra (SP-F-18).",
      "Resumen de los resultados (SP-F-19).",
      "Dictamen o informe de resultados"
    ],
    "recursos": "Tiempo / Económicos / Humanos / Tecnológicos",
    "criteriosMetodos": "Se especifican en el procedimiento de Medición de tierras físicas (SP-P-04).",
    "indicadores": "Se especifican en el Cuadro de mando para objetivos de calidad e indicadores."
  },
  {
    "slug": "verificacion-ruido",
    "etiqueta": "Verificación de niveles de ruido",
    "nombreProceso": "VERIFICACIÓN DE LOS NIVELES DE RUIDO",
    "responsable": "Técnico verificador",
    "objetivo": "Evaluar los niveles de ruido en las áreas y puestos de trabajo de los clientes que así lo soliciten.",
    "procesoAnterior": "PLANEACIÓN",
    "procesoSiguiente": "NINGUNO",
    "entradas": [
      "Información técnica o adicional del cliente.",
      "Normativa aplicable."
    ],
    "salidas": [
      "Resultados de las mediciones.",
      "Dictamen o informe de resultados"
    ],
    "recursos": "Tiempo / Económicos / Humanos / Tecnológicos",
    "criteriosMetodos": "Se especifican en el procedimiento de Verificación de los niveles de ruido (SP-P-05).",
    "indicadores": "Se especifican en el Cuadro de mando para objetivos de calidad e indicadores."
  },
  {
    "slug": "verificacion-iluminacion",
    "etiqueta": "Verificación de niveles de iluminación",
    "nombreProceso": "VERIFICACIÓN DE LOS NIVELES DE ILUMINACIÓN",
    "responsable": "Técnico verificador",
    "objetivo": "Evaluar los niveles de iluminación en las áreas y puestos de trabajo de los clientes que así lo soliciten.",
    "procesoAnterior": "PLANEACIÓN",
    "procesoSiguiente": "NINGUNO",
    "entradas": [
      "Hoja de reconocimiento (SP-F-25).",
      "Información técnica o adicional del cliente.",
      "Normativa aplicable."
    ],
    "salidas": [
      "Resultados de las medición (SP-F-26).",
      "Dicatamen o informe de resultados (SP-F-27)."
    ],
    "recursos": "Tiempo / Económicos / Humanos / Tecnológicos",
    "criteriosMetodos": "Se especifican en el procedimiento de Verificación de los niveles de iluminación (SP-P-06).",
    "indicadores": "Se especifican en el Cuadro de mando para objetivos de calidad e indicadores."
  },
  {
    "slug": "salud-ocupacional",
    "etiqueta": "Salud ocupacional",
    "nombreProceso": "SALUD OCUPACIONAL",
    "responsable": "Ejecutivo de Salud Ocupacional",
    "objetivo": "Ofrecer planes integrales de salud ocupacional o servicios individuales de salud a nuestros clientes.",
    "procesoAnterior": "PLANEACIÓN",
    "procesoSiguiente": "NINGUNO",
    "entradas": [
      "Plan de trabajo (formato SP-F-05).",
      "Normativa aplicable.",
      "Información técnica o adicional del cliente."
    ],
    "salidas": [
      "Servicio de salud proporcionado.",
      "Encuesta de satisfacción del cliente."
    ],
    "recursos": "Tiempo / Económicos / Humanos / Tecnológicos",
    "criteriosMetodos": "Se especifican en el procedimiento de Salud ocupacional (SP-P-07).",
    "indicadores": "Se especifican en el Cuadro de mando para objetivos de calidad e indicadores."
  },
  {
    "slug": "proteccion-civil",
    "etiqueta": "Protección civil",
    "nombreProceso": "PROTECCIÓN CIVIL",
    "responsable": "Ejecutivo de Seguridad Industrial",
    "objetivo": "Brindar soporte a nuestros clientes en materia de protección civil y asegurar que cumplan con los lineamientos o normativa aplicable.",
    "procesoAnterior": "PLANEACIÓN",
    "procesoSiguiente": "NINGUNO",
    "entradas": [
      "Plan de trabajo (formato SP-F-05).",
      "Lineamientos o normativa aplicable.",
      "Información técnica o adicional del cliente."
    ],
    "salidas": [
      "Cumplimiento de los lineamientos o",
      "normativa aplicable en materia de",
      "protección civil.",
      "Encuesta de satisfacción del cliente."
    ],
    "recursos": "Tiempo / Económicos / Humanos / Tecnológicos",
    "criteriosMetodos": "Se especifican en el procedimiento de Trámites (SP-P-03) y en la normativa aplicable.",
    "indicadores": "Se especifican en el Cuadro de mando para objetivos de calidad e indicadores."
  },
  {
    "slug": "proveeduria-externa",
    "etiqueta": "Proveeduría externa",
    "nombreProceso": "PROVEEDURÍA EXTERNA",
    "responsable": "Gerente de Administración y Talento Humano",
    "objetivo": "Adquirir los suministros necesarios para el establecimiento, implementación, mantenimiento y mejora del SGC.",
    "procesoAnterior": "PROCESOS ESTRATÉGICOS",
    "procesoSiguiente": "PROCESOS CLAVE",
    "entradas": [
      "Necesidad de compra de suministros, consumibles",
      "o cualquier otro requerimiento necesario",
      "para la operación de los procesos.",
      "Necesidad de procesos o servicios"
    ],
    "salidas": [
      "Orden de compra.",
      "Productos, servicios o procesos externos."
    ],
    "recursos": "Tiempo / Humano / Formatos / Económicos",
    "criteriosMetodos": "Se especifican en el procedimiento de Proveeduría externa (SGC-P-09).",
    "indicadores": "Se especifican en el Cuadro de mando para objetivos de calidad e indicadores."
  },
  {
    "slug": "reclutamiento-sel-y-cont",
    "etiqueta": "Reclutamiento, selección y contratación",
    "nombreProceso": "RECLUTAMIENTO, SELECCIÓN Y CONTRATACIÓN",
    "responsable": "Gerente de Administración y Talento Humano",
    "objetivo": "Contratar el talento humano adecuado para cada puesto",
    "procesoAnterior": "PROCESOS ESTRATÉGICOS",
    "procesoSiguiente": "PROCESOS CLAVE",
    "entradas": [
      "Identificación de las necesidades de la empresa",
      "Organigrama",
      "Descripción y perfiles de puestos",
      "Solicitudes de Empleo",
      "Publicación de vacantes"
    ],
    "salidas": [
      "Contratación de personal competente",
      "para el buen funcionamiento y",
      "operación de los procesos."
    ],
    "recursos": "",
    "criteriosMetodos": "",
    "indicadores": ""
  },
  {
    "slug": "competencia-y-cap",
    "etiqueta": "Competencia y capacitación",
    "nombreProceso": "COMPETENCIA Y CAPACITACIÓN",
    "responsable": "Gerente de Administración y Talento Humano",
    "objetivo": "Capacitar a las personas de la organización, que realizan un trabajo que afecta al desempeño del SGC, para adquirir la competencia necesaria para la operación de los procesos.",
    "procesoAnterior": "PROCESOS ESTRATÉGICOS",
    "procesoSiguiente": "PROCESOS CLAVE",
    "entradas": [
      "Puestos de trabajo con requerimientos específicos.",
      "Personas con necesidades de capacitación para cada puesto estratégico."
    ],
    "salidas": [
      "Descripciones de puesto.",
      "Expedientes del personal.",
      "Programa de capacitación, DNC, Evidencia de la",
      "eficacia de la capacitación."
    ],
    "recursos": "Tiempo / Humano / Formatos / Económicos",
    "criteriosMetodos": "Se especifican en el procedimiento de Competencia y capacitación (ATH-P-02).",
    "indicadores": "Se especifican en el Cuadro de mando para objetivos de calidad e indicadores."
  },
  {
    "slug": "manto-infraestructura",
    "etiqueta": "Mantenimiento de infraestructura",
    "nombreProceso": "MANTO. INFRAESTRUCTURA",
    "responsable": "Gerente de Estrategias e Innovación",
    "objetivo": "Proporcionar y mantener la infraestructura necesaria para la operación de los procesos.",
    "procesoAnterior": "PROCESOS ESTRATÉGICOS",
    "procesoSiguiente": "PROCESOS CLAVE",
    "entradas": [
      "Necesidades de mantenimiento.",
      "Programa de mantenimiento a la infraestructura.",
      "Solicitudes de mantenimiento."
    ],
    "salidas": [
      "Bitácora de mantenimiento.",
      "Facturas y/o reportes de mantenimiento",
      "de proveedores externos."
    ],
    "recursos": "Tiempo / Humano / Formatos / Económicos",
    "criteriosMetodos": "Se especifican en el procedimiento de Mantenimiento a la infraestructura (EIN-P-01).",
    "indicadores": "Se especifican en el Cuadro de mando para objetivos de calidad e indicadores."
  },
  {
    "slug": "control-de-documentos",
    "etiqueta": "Control de documentos",
    "nombreProceso": "CONTROL DE DOCUMENTOS",
    "responsable": "Coordinador del SGC",
    "objetivo": "Controlar documentos internos y externos que la organización requiere para su operación eficaz.",
    "procesoAnterior": "PROCESOS ESTRATÉGICOS",
    "procesoSiguiente": "PROCESOS CLAVE",
    "entradas": [
      "Información del SGC"
    ],
    "salidas": [
      "Documentos de control de información:",
      "Lista maestra de documentos internos/externos",
      "Lista de distribución, solicitud de cambios a",
      "documentos."
    ],
    "recursos": "Tiempo / Humano / Computadora o Laptop / Nube o servidor",
    "criteriosMetodos": "Se especifican en el procedimiento de Control de información documentada.",
    "indicadores": "Se especifican en el Cuadro de mando para objetivos de calidad e indicadores."
  },
  {
    "slug": "comunicacion",
    "etiqueta": "Comunicación",
    "nombreProceso": "COMUNICACIÓN",
    "responsable": "Coordinador del SGC",
    "objetivo": "Determinar las comunicaciones internas y externas pertinentes al SGC.",
    "procesoAnterior": "PROCESOS ESTRATÉGICOS",
    "procesoSiguiente": "PROCESOS CLAVE",
    "entradas": [
      "Información del SGC",
      "Necesidades de comunicación internas y externas relacionadas al sistema de gestión de calidad."
    ],
    "salidas": [
      "Tablero de comunicación"
    ],
    "recursos": "Tiempo / Humano",
    "criteriosMetodos": "Se especifican en la cláusula 7.4 Comunicación de la norma ISO 9001:2015",
    "indicadores": "Se especifican en el Cuadro de mando para objetivos de calidad e indicadores."
  },
  {
    "slug": "ambiente-para-la-opera",
    "etiqueta": "Ambiente para la operación",
    "nombreProceso": "AMB. PARA LA OPERACIÓN",
    "responsable": "Coordinador del SGC",
    "objetivo": "Proporcionar un ambiente adecuado para la operación de los procesos",
    "procesoAnterior": "PROCESOS ESTRATÉGICOS",
    "procesoSiguiente": "PROCESOS CLAVE",
    "entradas": [
      "Encuesta de clima laboral.",
      "Resultados de la encuesta."
    ],
    "salidas": [
      "Acciones derivadas de los resultados de la",
      "encuesta de clima laboral."
    ],
    "recursos": "Tiempo / Humano / Formato de la encuesta",
    "criteriosMetodos": "Se especifican en la cláusula 7.1.4 Ambiente para la operación de los procesos de la norma ISO 9001:2015",
    "indicadores": "Se especifican en el Cuadro de mando para objetivos de calidad e indicadores."
  },
  {
    "slug": "toma-de-conciencia",
    "etiqueta": "Toma de conciencia",
    "nombreProceso": "TOMA DE CONCIENCIA",
    "responsable": "Coordinador del SGC",
    "objetivo": "Asegurar que las personas que realizan el trabajo en la organización tomen conciencia de la política y objetivos de calidad, su contribución a la eficacia del SGC, incluidos los beneficios de una mejora del desempeño y las implicaciones de los requisitos del SGC.",
    "procesoAnterior": "PROCESOS ESTRATÉGICOS",
    "procesoSiguiente": "PROCESOS CLAVE",
    "entradas": [
      "Política de calidad.",
      "Objetivos de calidad.",
      "Plática de inducción.",
      "Información relacionada."
    ],
    "salidas": [
      "Personal sensibilizado"
    ],
    "recursos": "Tiempo / Humano / Económicos",
    "criteriosMetodos": "Se especifican en la cláusula 7.3 Toma de conciencia de la norma ISO 9001:2015.",
    "indicadores": "Se especifican en el Cuadro de mando para objetivos de calidad e indicadores."
  },
  {
    "slug": "conocimientos-de-la-org",
    "etiqueta": "Conocimientos de la organización",
    "nombreProceso": "CONOCIMIENTOS DE LA ORGANIZACIÓN",
    "responsable": "Coordinador del SGC",
    "objetivo": "Determinar los conocimientos necesarios para la operación de los procesos y así lograr la conformidad de los productos o servicios.",
    "procesoAnterior": "PROCESOS ESTRATÉGICOS",
    "procesoSiguiente": "PROCESOS CLAVE",
    "entradas": [
      "Procedimientos",
      "Instructivos de trabajo",
      "Manuales",
      "Documentos externos"
    ],
    "salidas": [
      "Conocimientos disponibles para la operación"
    ],
    "recursos": "Tiempo / Humano",
    "criteriosMetodos": "Se especifican en la cláusula 7.1.6 Conocimientos de la organización de la norma ISO 9001:2015.",
    "indicadores": "Se especifican en el Cuadro de mando para objetivos de calidad e indicadores."
  },
  {
    "slug": "recursos-de-medicion",
    "etiqueta": "Recursos de seguimiento y medición",
    "nombreProceso": "RECURSOS DE SEGUIMIENTO Y MEDICIÓN",
    "responsable": "Jefe de control de calidad",
    "objetivo": "Determinar y proporcionar los recursos necesarios para realizar el seguimiento y la medición para verificar la conformidad de los productos y servicios con los requisitos.",
    "procesoAnterior": "PROCESOS ESTRATÉGICOS",
    "procesoSiguiente": "PROCESOS CLAVE",
    "entradas": [
      "Necesidades de medición, verificación o validadción"
    ],
    "salidas": [
      "Listado y control de equipos de medición",
      "Certificados de calibración",
      "Resultados de verificación",
      "Equipos apropiados para la operación"
    ],
    "recursos": "Tiempo / Humano / Económicos / Infraestructura",
    "criteriosMetodos": "Se especifican en el procedimiento Equipos de medición.",
    "indicadores": "Se especifican en el Cuadro de mando para objetivos de calidad e indicadores."
  }
];
