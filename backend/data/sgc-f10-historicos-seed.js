/**
 * Precedente histórico SGC-F-10 (auditorías 01 y 02) extraído de los informes Word
 * en Drive. Se usa solo para seed del historial cerrado.
 *
 * Nunca escribe sobre el informe vigente del formato (producción / ciclo actual).
 */

const EMPRESA = 'BIZNAGA RISK AND TECH S DE R.L DE C.V.';
const DOMICILIO =
    'Calle Laguna no. 7 av. Francisco I Madero La Loma, Pachuca Hidalgo CP 42088.';
const OBJETIVOS =
    '1) Determinar la eficacia y el grado de conformidad del SGC con los criterios de auditoría.\n'
    + '2) Identificar las oportunidades para la mejora del SGC.';
const CRITERIOS =
    'Norma Internacional ISO 9001:2015 Sistemas de Gestión de Calidad – Requisitos.';
const ALCANCE =
    'Toda la norma, excepto los requisitos no aplicables declarados en el formato DG-F-02.';
const AUDITOR_LIDER = 'Sergio Guzmán Vigueras';
const AUDITORES = 'Areli González Mejía\nAlexis Martínez Flores';
const PARTICIPANTES = 'Gerentes, ejecutivos y colaboradores.';

const HISTORICOS = [
    {
        auditoriaNo: '01',
        fechasAuditoria: '3 y 4 de Sep. 2025',
        fechaAuditoria: '2025-09-04',
        anio: 2025,
        ubicaciones: 'Oficina Biznaga',
        empresa: EMPRESA,
        domicilio: DOMICILIO,
        objetivos: OBJETIVOS,
        criterios: CRITERIOS,
        alcance: ALCANCE,
        auditorLider: AUDITOR_LIDER,
        auditores: AUDITORES,
        participantes: PARTICIPANTES,
        otrosParticipantes: '1 Observador.',
        driveFileId: '1wAcvIFK42uW2LFKqwxcZ1wT642VStl27',
        driveFileName: 'Informe de auditoría BIZNAGA SEP-25.docx',
        conclusiones:
            'De acuerdo con toda la evidencia objetiva presentada durante la auditoría y la verificación de ésta con los criterios de auditoría (Norma Internacional ISO 9001:2015 Sistema de Gestión de la Calidad - Requisitos) se determinaron 4 no conformidades y 6 oportunidades de mejora. Dichas no conformidades se consideran 3 mayores, porque hay incumplimiento total de las cláusulas 7.1.3, 7.1.4, y 7.1.5; una menor, puesto que la evidencia mostró un cumplimiento parcial de la cláusula 7.5. Las seis oportunidades de mejora se refieren a las cláusulas 4.1, 7.1, 7.2, 8.1, 8.2.3 y 8.5.1.\n\n'
            + 'El grado de cumplimiento de los objetivos de auditoría se determina de la siguiente manera: El primer objetivo se considera en 100%, debido a que se logró determinar la eficacia y el grado de conformidad del SGC con los criterios de auditoría. El grado de cumplimiento del segundo objetivo de la auditoría, se considera en un 100%, pues se pudieron identificar las oportunidades de mejora para el mantenimiento y adecuación del Sistema de Gestión de Calidad de BIZNAGA.\n\n'
            + 'En cuanto al alcance de la auditoría, se logró cubrir el 100% las cláusulas (requisitos) consideradas como aplicables, con excepción de la no aplicabilidad declarada en el alcance del sistema de gestión de calidad.\n\n'
            + 'El Sistema de Gestión de Calidad de BIZNAGA, representa en este momento, un grado de madurez inicial con oportunidades de mejora notables en algunos aspectos que, si se atienden adecuadamente, contribuirán a la eficacia del sistema de gestión para alcanzar los resultados previstos.\n\n'
            + 'Algo a considerar, derivado de esta auditoría, es continuar con auditorías internas por lo menos cada 6 meses, en tanto el sistema de gestión de calidad madura paulatinamente.',
        hallazgos: [
            {
                clausula: '4.1 Comprensión de la organización y de su contexto.',
                clasificacion: 'OP',
                descripcion:
                    'Esta cláusula establece que la organización debe determinar las cuestiones externas e internas que son pertinentes para su propósito y su dirección estratégica. Además de que la organización debe realizar el seguimiento y la revisión de la información sobre estas cuestiones externas e internas.\n\n'
                    + 'El auditado no pudo acreditar el seguimiento de todas las cuestiones externas e internas. No se mostró evidencia de seguimiento a las estrategias de cartera de cobro, cartera de socios estratégicos, listado de licitaciones. Mencionó que para este seguimiento se hacían planes de acción, sin embargo, no pudo mostrar evidencia de la planeación de estas cuestiones.',
                procesos: 'Dirección General'
            },
            {
                clausula: '7.1 Recursos',
                clasificacion: 'OP',
                descripcion:
                    'Esta cláusula establece que la organización debe determinar y proporcionar los recursos necesarios para el establecimiento, implementación, mantenimiento y mejora continua del sistema de gestión de la calidad.\n\n'
                    + 'El auditado no mostró evidencia de la programación de los recursos para el mantenimiento y mejora del SGC.',
                procesos: 'Dirección General'
            },
            {
                clausula: '7.1.3 Infraestructura',
                clasificacion: 'NC_MAYOR',
                descripcion:
                    'Esta cláusula establece que la organización debe determinar, proporcionar y mantener la infraestructura necesaria para la operación de sus procesos y lograr la conformidad de los productos y servicios.\n\n'
                    + 'Durante la revisión documental el auditado no mostró evidencia objetiva de la implementación del programa de mantenimiento a la infraestructura (EIN-F-01). También se encontró que los elementos de infraestructura declarados por el auditado no correspondían a los establecidos en el formato anterior. Adicionalmente se encontró que no había fechas de programación de los mantenimientos preventivos.\n\n'
                    + 'El auditado declaró que se hizo un mantenimiento correctivo de una impresora, pero no hay registro de la solicitud de mantenimiento (EIN-F-02) para mantenimiento correctivo declarado en su procedimiento, ni registro en la bitácora de mantenimiento (EIN-F-03).',
                procesos: 'Mantenimiento a la infraestructura'
            },
            {
                clausula: '7.1.4 Ambiente para la operación de los procesos',
                clasificacion: 'NC_MAYOR',
                descripcion:
                    'Esta cláusula establece que la organización debe determinar, proporcionar y mantener el ambiente necesario para la operación de sus procesos y para lograr la conformidad de los productos y servicios.\n\n'
                    + 'Durante la revisión documental el auditado no presentó la evidencia objetiva sobre el seguimiento (por algún método) para determinar el ambiente para la operación de los procesos. El auditado mencionó que están en proceso de implementación de la NOM-035-STPS-2018.',
                procesos: 'Talento Humano'
            },
            {
                clausula: '7.1.5 Recursos de seguimiento y medición',
                clasificacion: 'NC_MAYOR',
                descripcion:
                    'Esta cláusula establece que la organización debe determinar y proporcionar los recursos necesarios para asegurarse de la validez y fiabilidad de los resultados cuando se realice el seguimiento o la medición para verificar la conformidad de los productos y servicios con los requisitos.\n\n'
                    + 'El auditado mencionó que los equipos que se utilizan para verificar la conformidad de los servicios que ofrece Biznaga referentes a la medición de iluminación, ruido, tierras físicas y capacidad respiratoria, no se encontraban disponibles en la oficina al momento de la auditoría, por tanto, no se pudo asegurar que son apropiados para el tipo específico de actividades de medición.\n\n'
                    + 'El auditado no pudo mostrar evidencia sólida de la programación de la calibración o verificación de sus equipos de medición a intervalos planificados. Tampoco se encontró evidencia de información documentada sobre los resultados de la calibración o verificación (certificados de calibración). No se pudo evaluar si los equipos de medición declarados en el formato Bitácora de calibración y verificación de equipos de medición (SGC-F-17) estaban identificados y tampoco se pudo demostrar si los equipos de medición se encontraban en buen estado, debido a que no estaban disponibles.',
                procesos: 'Sistema de Gestión de Calidad'
            },
            {
                clausula: '7.2 Competencia',
                clasificacion: 'OP',
                descripcion:
                    'Esta cláusula establece que la organización debe determinar la competencia necesaria de las personas que realizan, bajo su control, un trabajo que afecta al desempeño y eficacia del sistema de gestión de la calidad. Así mismo debe asegurarse de que estas personas sean competentes, basándose en la educación, formación o experiencia apropiadas. Durante la revisión documental se encontró que el expediente del Ing. Edmundo Zayago (Ejecutivo de Seguridad Industrial) no cuenta con título profesional, por lo que no se acredita la educación de este trabajador.\n\n'
                    + 'Además, derivado de la información contenida en su procedimiento para el reclutamiento, selección y contratación (ATH-P-01) se identificó que la requisición de personal (ATH-F-03) no se está utilizando durante el proceso de reclutamiento y selección. No se encontró registro alguno sobre los detalles relevantes de la entrevista ni del candidato anotados, según su procedimiento, en el CV o solicitud de empleo.\n\n'
                    + 'También establece que, cuando sea aplicable, la organización debe tomar acciones para adquirir la competencia necesaria y evaluar la eficacia de las acciones tomadas, encontrándose que no se utiliza el formato eficacia de la capacitación (ATH-F-08) para evaluar la eficacia de las acciones tomadas.',
                procesos: 'Competencia y capacitación'
            },
            {
                clausula: '7.5 Información documentada',
                clasificacion: 'NC_MENOR',
                descripcion:
                    'Esta cláusula establece que, al crear y actualizar la información documentada, la organización debe asegurarse de que lo siguiente sea apropiado: identificación y descripción; formato y medios de soporte; revisión y aprobación.\n\n'
                    + 'Se detectó durante la revisión documental que el formato listado maestro de documentación a solicitar (SP-F-01), con número de revisión 01 y con fecha de revisión del 18-09-24 es una versión antigua respecto a la lista maestra de control de documentos (SGC-F-01). Resaltar que el formato SP-F-01 fue mostrado en dos procesos distintos: consultoría estratégica (seguridad industrial) y en el proceso de trámites (ambiental).',
                procesos: 'Trámites (ambiental) y consultoría estratégica (seguridad industrial)'
            },
            {
                clausula: '8.2.3 Revisión de los requisitos para los productos y servicios',
                clasificacion: 'OP',
                descripcion:
                    'Esta cláusula establece que la organización debe asegurarse de que tiene la capacidad de cumplir los requisitos para los productos y servicios que se van a ofrecer a los clientes. La organización debe llevar a cabo una revisión antes de comprometerse a suministrar productos y servicios a un cliente.\n\n'
                    + 'También establece que la organización debe confirmar los requisitos del cliente antes de la aceptación, cuando el cliente no proporcione una declaración documentada de sus requisitos.\n\n'
                    + 'El auditado mencionó que algunas de las cotizaciones no cuentan con la firma de aceptación del cliente, por lo tanto, no se confirman los requisitos para la provisión del servicio por esos clientes.',
                procesos: 'Cotización, contrato, pago y facturación'
            },
            {
                clausula: '8.1 Planificación y control operacional',
                clasificacion: 'OP',
                descripcion:
                    'Esta cláusula establece que la organización debe planificar, implementar y controlar los procesos (véase 4.4) necesarios para cumplir los requisitos para la provisión de productos y servicios.\n\n'
                    + 'Durante la auditoría se encontró que el proyecto de CREST NORTEAMÉRICA (Ambiental) no se asocia con un plan de trabajo (Control de avance de proyecto SP-F-05) declarado en el procedimiento de Trámites (SP-P-03). Además de que las actividades 4, 5, 6 y 7 del procedimiento de trámites no es la secuencia correcta, pues el auditado la describió de otra forma.',
                procesos: 'Trámites (Ambiental)'
            },
            {
                clausula: '8.5.1 Control de producción y de la provisión del servicio',
                clasificacion: 'OP',
                descripcion:
                    'Esta cláusula establece que la organización debe implementar la producción y provisión del servicio bajo condiciones controladas.\n\n'
                    + 'Durante la revisión documental se encontró que el curso de capacitación de Auditores Internos para auditar Sistemas de Gestión Ambiental ISO 14001:2015, proporcionado a la empresa TEXIN S.A DE C.V., no se registró en el formato control del capacitación empresarial (SP-F-13).',
                procesos: 'Capacitación empresarial'
            }
        ]
    },
    {
        auditoriaNo: '02',
        fechasAuditoria: '31 de marzo y 1 de abril 2026',
        fechaAuditoria: '2026-04-01',
        anio: 2026,
        ubicaciones: 'Oficina Biznaga',
        empresa: EMPRESA,
        domicilio: DOMICILIO,
        objetivos: OBJETIVOS,
        criterios: CRITERIOS,
        alcance: ALCANCE,
        auditorLider: AUDITOR_LIDER,
        auditores: AUDITORES,
        participantes: PARTICIPANTES,
        otrosParticipantes: 'Ninguno.',
        driveFileId: '1pz_-AZ963GdIRR2sYIR9b7AY4hjSiGaW',
        driveFileName: 'Informe de auditoria BIZNAGA ABR26-2.docx',
        conclusiones:
            'De acuerdo con toda la evidencia objetiva presentada durante la auditoría y la verificación de ésta con los criterios de auditoría (Norma Internacional ISO 9001:2015 Sistema de Gestión de la Calidad - Requisitos) se determinaron 8 no conformidades y 1 oportunidad de mejora. Dichas no conformidades se consideran 1 mayor, porque hay incumplimiento total de la cláusula 8.1 y 7 menores, puesto que la evidencia mostró un cumplimiento parcial de las cláusulas 4.1, 7.1.3, 7.5, 8.2.3, 8.5.1, 8.5.2 y 9.1.2. La oportunidad de mejora se refiere a la cláusula 7.2.\n\n'
            + 'El grado de cumplimiento de los objetivos de auditoría se determina de la siguiente manera: El primer objetivo se considera en 100%, debido a que se logró determinar la eficacia y el grado de conformidad del SGC con los criterios de auditoría. El grado de cumplimiento del segundo objetivo de la auditoría, se considera en un 100%, pues se pudieron identificar las oportunidades de mejora para el mantenimiento y adecuación del Sistema de Gestión de Calidad de BIZNAGA.\n\n'
            + 'En cuanto al alcance de la auditoría, se logró cubrir el 100% las cláusulas (requisitos) consideradas como aplicables, con excepción de la no aplicabilidad declarada en el alcance del sistema de gestión de calidad.\n\n'
            + 'El Sistema de Gestión de Calidad de BIZNAGA, representa en este momento, un grado de madurez medio, con oportunidades de mejora notables en algunos aspectos que, si se atienden adecuadamente, contribuirán a la eficacia del sistema de gestión para alcanzar los resultados previstos.\n\n'
            + 'Algo a considerar, derivado de esta auditoría, es continuar con auditorías internas por lo menos cada 6 meses, en tanto el sistema de gestión de calidad madura paulatinamente.',
        hallazgos: [
            {
                clausula: '4.1 Comprensión de la organización y de su contexto.',
                clasificacion: 'NC_MENOR',
                descripcion:
                    'Esta cláusula establece que la organización debe determinar las cuestiones externas e internas que son pertinentes para su propósito y su dirección estratégica. Además de que la organización debe realizar el seguimiento y la revisión de la información sobre estas cuestiones externas e internas.\n\n'
                    + 'El auditado no pudo acreditar el seguimiento de todas las cuestiones externas e internas. No se mostró evidencia de seguimiento a las siguientes estrategias: cartera de cobro, el auditado mencionó que se realizó una reunión con el Gerente de Administración y Talento Humano, sin embargo, no se llevó a cabo registro alguno sobre esa reunión como evidencia; cartera de socios estratégicos, el auditado mencionó que no hay convenio escrito con los socios comerciales de Biznaga, sólo hay una reunión con acuerdos, pero sin registro alguno.',
                procesos: 'Dirección General'
            },
            {
                clausula: '7.1.3 Infraestructura',
                clasificacion: 'NC_MENOR',
                descripcion:
                    'Esta cláusula establece que la organización debe determinar, proporcionar y mantener la infraestructura necesaria para la operación de sus procesos y lograr la conformidad de los productos y servicios.\n\n'
                    + 'Durante la entrevista el auditado mencionó que no existe un procedimiento documentado para el mantenimiento de la infraestructura de Biznaga y que no cuenta con un historial de los mantenimientos preventivos y correctivos realizados. Además, al hacer un muestreo de los mantenimientos preventivos del programa de mantenimiento a la infraestructura (EIN-F-01), se encontró que el mantenimiento a la NUBE no cuenta con registro alguno. El auditado mencionó que se tuvo una reunión con el proveedor, pero no se generó ningún reporte o evidencia.',
                procesos: 'Mantenimiento a la infraestructura'
            },
            {
                clausula: '7.5 Información documentada',
                clasificacion: 'NC_MENOR',
                descripcion:
                    'Esta cláusula establece que, al crear y actualizar la información documentada, la organización debe asegurarse de que lo siguiente sea apropiado: identificación y descripción; formato y medios de soporte; revisión y aprobación.\n\n'
                    + 'Se detectó durante la revisión documental que el procedimiento Trámites (SP-P-03), no cuenta con la firma de aprobación del Ejecutivo de Sistemas de Gestión y Capacitación. También se mencionó por parte del auditado que la Política de calidad (SGC-PO-01) sufrió cambios en el mes de julio de 2025, sin embargo, al revisar la versión del documento se mostraba número de revisión 00.',
                procesos: 'Gestión de Calidad'
            },
            {
                clausula: '8.2.3 Revisión de los requisitos para los productos y servicios',
                clasificacion: 'NC_MENOR',
                descripcion:
                    'Esta cláusula establece que la organización debe asegurarse de que tiene la capacidad de cumplir los requisitos para los productos y servicios que se van a ofrecer a los clientes.\n\n'
                    + 'Al hacer un muestreo aleatorio de algunas de las cotizaciones se encontró que la cotización B-SC-26-045 del cliente BOMBAS GOULDS DE MÉXICO S. DE R.L. DE C.V. del servicio de COA, no cuenta con la firma de aceptación por parte del cliente, por lo tanto, no se confirmó los requisitos para la provisión del servicio por ese cliente.',
                procesos: 'Cotización, contrato, pago y facturación'
            },
            {
                clausula: '8.1 Planificación y control operacional.',
                clasificacion: 'NC_MAYOR',
                descripcion:
                    'Esta cláusula establece que la organización debe planificar, implementar y controlar los procesos necesarios para cumplir los requisitos para la provisión de productos y servicios.\n\n'
                    + 'Durante la revisión documental el auditado menciono no contar con ningún documento que controle como se llevan a cabo sus actividades para la prestación del servicio de Salud Ocupacional, no contando con ningún tipo de procedimiento documentado con el cual poder realizar la auditoria.\n\n'
                    + 'Durante la auditoría se encontró que el proyecto de CREST NORTEAMÉRICA (Ambiental) no se asocia con un plan de trabajo (Control de avance de proyecto SP-F-05) declarado en el procedimiento de Trámites (SP-P-03). Además de que las actividades 4, 5, 6 y 7 del procedimiento de trámites no es la secuencia correcta, pues el auditado la describió de otra forma.',
                procesos: 'Salud Ocupacional y Trámites (Ambiental)'
            },
            {
                clausula: '8.5.1 Control de producción y de la provisión del servicio',
                clasificacion: 'NC_MENOR',
                descripcion:
                    'Esta cláusula establece que la organización debe implementar la producción y provisión del servicio bajo condiciones controladas.\n\n'
                    + 'Durante la revisión documental se encontró que ninguno de los proyectos realizados en base a normativas aplicables en las empresas, no son registrados en el formato Control de avance de proyecto (SP-F-05).\n\n'
                    + 'Durante la revisión documental se encontró que el formato Listado maestro de documentación a solicitar (SP-F-01) no se llena al momento de recibir la información por parte del cliente para verificar que los documentos que recibe biznaga está completo.\n\n'
                    + 'También se encontró que en el Reporte de visita y recorrido (SP-F-02), revisión 00, con fecha de revisión del 05-08-21, no se cambia el estatus “abierto” de las acciones correctivas de las observaciones encontradas durante el recorrido, ni se verifica que se hayan realizado.\n\n'
                    + 'Durante la auditoría se encontró que para el seguimiento de condicionantes ambientales se omitió el uso del formato Control de estatus de trámites (SP-F-28) declarado en el procedimiento de Trámites (SP-P-03).\n\n'
                    + 'El auditado mencionó que no hace uso de un solo formato en el que se plasme las actividades realizadas, algunas veces hace uso del formato Control de avance de proyecto (SP-F-05) y en otras ocasiones hace uso de Reporte de visita y recorrido (SP-F-02).\n\n'
                    + 'Durante la realización de la auditoria al revisar los proyectos más recientes del auditado aún sin concluir se notó la ausencia del número de proyecto en los formatos de Control de Avance del Proyecto (SP-F-05), al preguntar la razón de esta ausencia al auditado respondió que en ocasiones no se le comunican estos números de control al iniciar el proyecto.',
                procesos: 'Protección Civil, Trámites (ambiental), Seguridad Industrial'
            },
            {
                clausula: '8.5.2 Identificación y trazabilidad',
                clasificacion: 'NC_MENOR',
                descripcion:
                    'Esta cláusula establece que la organización debe utilizar los medios apropiados para identificar las salidas, cuando sea necesario, para asegurar la conformidad de los productos y servicios.\n\n'
                    + 'El auditado al mostrar las cotizaciones realizadas, la identificación no coincide con el instructivo mostrado.\n\n'
                    + 'Durante la revisión documental se realizó un muestreo al Control de Proyectos Biznaga (SP-F-04), donde no se pudo hallar evidencia (registros) del Control de Avance del Proyecto (SP-F-05) de los proyectos con número de identificación EAD-SC-25-044 y INT-SC-25-082.',
                procesos: 'Consultoría estratégica, Administración y Gestión de Calidad'
            },
            {
                clausula: '9.1.2 Satisfacción del cliente',
                clasificacion: 'NC_MENOR',
                descripcion:
                    'Esta cláusula establece que la organización debe realizar el seguimiento de las percepciones de los clientes del grado en que se cumplen sus necesidades y expectativas. Además, debe determinar los métodos para obtener, realizar el seguimiento y revisar esta información.\n\n'
                    + 'Durante la revisión documental se encontró que el indicador que se atribuye al método utilizado para realizar el seguimiento de las percepciones de los clientes no cuenta con registro de 2025, dado que el auditado mencionó que se mide cada año, por lo que en 2026 no hay registros aún se le cuestionó por el año anterior.',
                procesos: 'Gestión de Calidad'
            },
            {
                clausula: '7.2 Competencia',
                clasificacion: 'OP',
                descripcion:
                    'Esta cláusula establece que la organización debe determinar la competencia necesaria de las personas que realizan, bajo su control, un trabajo que afecta al desempeño y eficacia del sistema de gestión de la calidad. Así mismo debe asegurarse de que estas personas sean competentes, basándose en la educación, formación o experiencia apropiadas.\n\n'
                    + 'También establece que, cuando sea aplicable, la organización debe tomar acciones para adquirir la competencia necesaria y evaluar la eficacia de las acciones tomadas, encontrándose que el curso de comunicación asertiva programado para el mes de marzo de 2026 no se ha implementado.',
                procesos: 'Competencia y capacitación'
            }
        ]
    }
];

module.exports = { HISTORICOS };
