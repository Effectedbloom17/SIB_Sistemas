/** Plantilla en carpeta Google Drive (nombre debe coincidir con el archivo en Drive). */
export interface PlantillaFormato {
  /** Código del formato (p. ej. DG-F-04, ATH-F-02). */
  codigo: string;
  /** Nombre legible para la interfaz. */
  titulo: string;
  /** Nombre del archivo en Drive. */
  nombre: string;
  driveFileId?: string;
  /** Ruta relativa: /sistema-gestion-calidad/{slug}/plantilla/{previewSlug} */
  previewSlug?: string;
  /** embed = visor Drive; form = maqueta interactiva en el sistema. */
  previewMode?: 'embed' | 'form';
  /** Ruta en assets/ para imagen estática de la vista (respaldo local). */
  imagenVistaAssetPath?: string;
  /** ID del JPG en Drive que se reemplaza al subir una nueva imagen. */
  imagenVistaDriveFileId?: string;
}

export interface CapituloFormatoConfig {
  slug: string;
  numero: number;
  titulo: string;
  /** Clases completas del icono Font Awesome en el hero. */
  heroIconClass: string;
  carpetaDrive?: string;
  plantillas: PlantillaFormato[];
}

export const SGC_CAPITULOS_CATALOG: Record<string, CapituloFormatoConfig> = {
  'capitulo-4': {
    slug: 'capitulo-4',
    numero: 4,
    titulo: 'Contexto de la organización',
    heroIconClass: 'fas fa-sitemap',
    carpetaDrive:
      'https://drive.google.com/drive/folders/1W9Zxve87e85bkWeRpy-0P-QuMh1IeOT4?usp=drive_link',
    plantillas: [
      {
        codigo: 'DG-F-04',
        titulo: 'Análisis FODA',
        nombre: 'DG-F-04 Análisis FODA.xlsx',
        driveFileId: '1SMkPlfUpFctTjesbStrD7P_t9Q5fA_tG',
        previewSlug: 'dg-f-04',
        previewMode: 'form'
      },
      {
        codigo: 'DG-F-05',
        titulo: 'Listado de partes interesadas',
        nombre: 'DG-F-05 Listado de partes interesadas.xlsx',
        driveFileId: '1TztLGOGdIW6P-zhjy_kBYAK4GfmX5nPF',
        previewSlug: 'dg-f-05',
        previewMode: 'form'
      },
      {
        codigo: 'DG-F-02',
        titulo: 'Alcance',
        nombre: 'DG-F-02 Alcance.docx',
        driveFileId: '1u6lOOpunb83isnYK__wG9IV9iH14eEzH',
        previewSlug: 'dg-f-02',
        previewMode: 'form'
      },
      {
        codigo: 'DG-F-01',
        titulo: 'Mapa de procesos',
        nombre: 'DG-F-01 Mapa de procesos.docx',
        driveFileId: '1pGjp2vs-r-usYl160g2O4N8zfgSAkSYR',
        previewSlug: 'dg-f-01',
        previewMode: 'form',
        imagenVistaAssetPath: 'assets/img/img_SGC/dg-f-01-mapa-procesos.jpg',
        imagenVistaDriveFileId: '1VBnj5OeYjqcyrymrQrLOs68wsS1aLrzJ'
      },
      {
        codigo: 'DG-F-07',
        titulo: 'Caracterización de procesos',
        nombre: 'DG-F-07 Caracterización de procesos.xlsx',
        driveFileId: '1Iyr5StRrsuDWHkSN-7MbiLswUwb01kzO',
        previewSlug: 'dg-f-07',
        previewMode: 'form'
      }
    ]
  },

  'capitulo-5': {
    slug: 'capitulo-5',
    numero: 5,
    titulo: 'Liderazgo',
    heroIconClass: 'fas fa-user-tie',
    carpetaDrive:
      'https://drive.google.com/drive/folders/1IIlNXxAE2h-AiVbZDDr6zuGa87NXdFLm?usp=drive_link',
    plantillas: [
      {
        codigo: 'SGC-F-18',
        titulo: 'Tabla de requisitos legales y reglamentarios',
        nombre: 'Tabla de requisitos legales y reglamentarios (Rev 00 03-07-25).xlsx',
        driveFileId: '168hssf8Gj1hfrzQ0sYqQB7JxO9IwmmzV',
        previewSlug: 'sgc-f-18',
        previewMode: 'form'
      },
      {
        codigo: 'SGC-PO-01',
        titulo: 'Política de calidad',
        nombre: 'SGC-PO-01 Politica de calidad_Biznaga.docx',
        driveFileId: '1lTfkG06cJxVKx4oQWtwXkCojVGnDByNZ',
        previewSlug: 'sgc-po-01',
        previewMode: 'form'
      },
      {
        codigo: 'DG-F-08',
        titulo: 'Filosofía Biznaga Risk and Tech',
        nombre: 'DG-F-08 Filosofía Biznaga Risk and Tech.docx',
        driveFileId: '1I_w2I7K2cm4HSsqnF1xk7Zz1OsXGldLq',
        previewSlug: 'dg-f-08',
        previewMode: 'form'
      }
    ]
  },

  'capitulo-6': {
    slug: 'capitulo-6',
    numero: 6,
    titulo: 'Planificación',
    heroIconClass: 'fas fa-calendar-check',
    carpetaDrive:
      'https://drive.google.com/drive/folders/1v2IBrryAJg5fILPH602gm_CZhJNyia82?usp=drive_link',
    plantillas: [
      {
        codigo: 'SGC-F-11',
        titulo: 'AMEF',
        nombre: 'SGC-F-11 AMEF.xlsx',
        driveFileId: '1WMWdR8NbUXoBRANEPXBp5uMES2l5ekwQ',
        previewSlug: 'sgc-f-11',
        previewMode: 'form'
      },
      {
        codigo: 'DG-F-03',
        titulo: 'Objetivos de calidad',
        nombre: 'DG-F-03 Objetivos de calidad.docx',
        driveFileId: '1WfvG2rQKY_Hugj65BhNbEnxhpGznDmBg',
        previewSlug: 'dg-f-03',
        previewMode: 'form'
      },
      {
        codigo: 'SGC-F-12',
        titulo: 'Notificación de cambios al SGC',
        nombre: 'SGC-F-12 Notificacion de cambios al SGC.xlsx',
        driveFileId: '1n0TAYAe9b-Q_XAYUXYArqqYPz60cLFjY',
        previewSlug: 'sgc-f-12',
        previewMode: 'form'
      },
      {
        codigo: 'SGC-DI-06',
        titulo: 'Metodología AMEF',
        nombre: 'Metodología AMEF.pptx',
        driveFileId: '1xZV8qrebRvCovN1cXOXO3EcCZhCjs-Ck',
        previewSlug: 'metodologia-amef',
        previewMode: 'form'
      }
    ]
  },

  'capitulo-7': {
    slug: 'capitulo-7',
    numero: 7,
    titulo: 'Apoyo',
    heroIconClass: 'fas fa-hands-helping',
    carpetaDrive:
      'https://drive.google.com/drive/folders/1IIlNXxAE2h-AiVbZDDr6zuGa87NXdFLm?usp=drive_link',
    plantillas: [
      {
        codigo: 'SGC-F-01',
        titulo: 'Lista maestra de documentos controlados',
        nombre: 'SGC-F-01 Lista maestra de documentos controlados REV 00',
        driveFileId: '1NAgUvvargXH3dkICZ0WQePJvt2Q3zUmbApAbwBhr6WY',
        previewSlug: 'sgc-f-01',
        previewMode: 'form'
      },
      {
        codigo: 'SGC-F-02',
        titulo: 'Solicitud de cambios a documentos',
        nombre: 'SGC-F-02 Solicitud de cambios a documentos',
        driveFileId: '1HIOltlUF0O9zxZ6tedSSCZgzuG0eSw45iHe3IKdF9xQ',
        previewSlug: 'sgc-f-02',
        previewMode: 'form'
      },
      {
        codigo: 'ATH-F-08',
        titulo: 'Eficacia de la capacitación',
        nombre: 'ATH-F-08 Eficacia de la capacitación',
        driveFileId: '1-tq5eEeFmUPk8cJXOmPEXpycthXTXwe6kwK_-M-7kww',
        previewSlug: 'ath-f-08',
        previewMode: 'form'
      }
    ]
  },

  'capitulo-8': {
    slug: 'capitulo-8',
    numero: 8,
    titulo: 'Operación',
    heroIconClass: 'fas fa-cogs',
    plantillas: [
      {
        codigo: 'ATH-F-09',
        titulo: 'Cotización',
        nombre: 'ATH-F-09 Cotización Rev 2.docx',
        driveFileId: '1hvmnBHHyGmNDnHEaAmXiwNup3m5PL2yu',
        previewSlug: 'ath-f-09',
        previewMode: 'form'
      },
      {
        codigo: 'SGC-F-28',
        titulo: 'Comparativa de proveedores',
        nombre: 'SGC-F-28 Comparativa de proveedores.xlsx',
        driveFileId: '1PxxA5U1Z0tOpbaj1eH8agdxOuQVgF8ya8VU2Uc9BhOI',
        previewSlug: 'sgc-f-28',
        previewMode: 'form'
      },
      {
        codigo: 'SGC-F-29',
        titulo: 'Evaluación de proveedores',
        nombre: 'SGC-F-29 Evaluación de Proveedores.xlsx',
        driveFileId: '1_MsV1j-HuRUr8mdJogU0NmZL0j0zb35Ty5EtQ0cbCfQ',
        previewSlug: 'sgc-f-29',
        previewMode: 'form'
      },
      {
        codigo: 'SP-F-02',
        titulo: 'Reporte de visita y recorrido',
        nombre: 'SP-F-02 Reporte de visita y recorrido.xlsx',
        driveFileId: '1lZOjlr7PAvoudcOJF5Qz28x3ok88UUEb32L1YnxUAZI',
        previewSlug: 'sp-f-02',
        previewMode: 'form'
      }
    ]
  },

  'capitulo-9': {
    slug: 'capitulo-9',
    numero: 9,
    titulo: 'Evaluación del desempeño',
    heroIconClass: 'fas fa-chart-line',
    plantillas: [
      {
        codigo: 'ATH-F-11',
        titulo: 'Evaluación de desempeño',
        nombre: 'ATH-F-11 Evaluación de desempeño (sistema)',
        driveFileId: '10fvVzAiuTVoCva9QAYufIJmGbK1gMdZF3uBvW6Ohxyk',
        previewSlug: 'ath-f-11',
        previewMode: 'form'
      },
      {
        codigo: 'SGC-F-06',
        titulo: 'Lista y calificación de auditores',
        nombre: 'SGC-F-06 Lista y calificación de auditores.xlsx',
        driveFileId: '172FXnaaY-62DluYGLjZRogqZF3ZZ_aFwCf4Ww-31T2A',
        previewSlug: 'sgc-f-06',
        previewMode: 'form'
      },
      {
        codigo: 'SGC-F-07',
        titulo: 'Programa de auditoría',
        nombre: 'SGC-F-07 Programa de auditoría.xlsx',
        driveFileId: '1JeFz9EUCEPfRcFw90vSO8PHTq9TMX_Jr',
        previewSlug: 'sgc-f-07',
        previewMode: 'form'
      },
      {
        codigo: 'SGC-F-08',
        titulo: 'Plan de auditoría',
        nombre: 'SGC-F-08 Plan de auditoría.xlsx',
        driveFileId: '19R5biJd2EHKN6OURoSEpvLnDWQSDi8YjfL9PhVdla-0',
        previewSlug: 'sgc-f-08',
        previewMode: 'form'
      },
      {
        codigo: 'SGC-F-09',
        titulo: 'Lista de verificación de auditoría',
        nombre: 'SGC-F-09 Lista de verificación de auditoría.docx',
        driveFileId: '1QP_CEWuDTRJbZiOth-JLxQvw713mSxbp',
        previewSlug: 'sgc-f-09',
        previewMode: 'form'
      },
      {
        codigo: 'SGC-F-10',
        titulo: 'Informe de auditoría',
        nombre: 'SGC-F-10 Informe de auditoría.docx',
        driveFileId: '1xHRlZqE7k733GqeeELyjwDHY2ljHViG5K3p9ArstWc4',
        previewSlug: 'sgc-f-10',
        previewMode: 'form'
      },
      {
        codigo: 'SGC-F-16',
        titulo: 'Minuta',
        nombre: 'SGC-F-16 Minuta.xlsx',
        driveFileId: '1Rc-mprKV22mONhk81zHjPTChaEgF0HBiUESRx8D_y-M',
        previewSlug: 'sgc-f-16',
        previewMode: 'form'
      },
      {
        codigo: 'DG-F-06',
        titulo: 'Cuadro de mando',
        nombre: 'DG-F-06 Cuadro de mando.xlsx',
        driveFileId: '1sjnun7HgBMf-o9iDRLvN5C7yH_5vJkKSf7mnaGxGGOI',
        previewSlug: 'dg-f-06',
        previewMode: 'form'
      },
      {
        codigo: 'ATH-F-02',
        titulo: 'Descripción y perfil de puesto',
        nombre: 'ATH-F-02 Descripción y perfil de puesto.xlsx',
        driveFileId: '1uyxfaSKI_TzBwMeoWHK34pCOyAGusujC',
        previewSlug: 'ath-f-02',
        previewMode: 'form'
      }
    ]
  },

  'capitulo-10': {
    slug: 'capitulo-10',
    numero: 10,
    titulo: 'Mejora',
    heroIconClass: 'fas fa-sync-alt',
    plantillas: [
      {
        codigo: 'SGC-F-04',
        titulo: 'Reporte de no conformidad',
        nombre: 'SGC-F-04 Reporte de no conformidad Rev 02.xlsx',
        driveFileId: '1QdDYj8DlY4cAsWpF0UZd7SnoJ2t52WzhnXgrKQ80GvU',
        previewSlug: 'sgc-f-04',
        previewMode: 'form'
      },
      {
        codigo: 'SGC-F-05',
        titulo: 'Bitácora de no conformidades',
        nombre: 'SGC-F-05 Bitacora de no conformidades.xlsx',
        driveFileId: '17Rd37pyaQqubyndRcouc1TwOEgn6myZWlN0t05MW7MY',
        previewSlug: 'sgc-f-05',
        previewMode: 'form'
      },
      {
        codigo: 'SGC-F-14',
        titulo: 'Bitácora de proyectos de mejora',
        nombre: 'SGC-F-14 Bitácora de proyectos de mejora.xlsx',
        driveFileId: '139p7a689G58heuOBYV7Z93KErY_PENgdY97EOvrcZNk',
        previewSlug: 'sgc-f-14',
        previewMode: 'form'
      }
    ]
  }
};

/** Capítulos ISO 9001 disponibles en el sistema (4 al 10), en orden. */
export const SGC_CAPITULOS_ORDEN: CapituloFormatoConfig[] = [
  SGC_CAPITULOS_CATALOG['capitulo-4'],
  SGC_CAPITULOS_CATALOG['capitulo-5'],
  SGC_CAPITULOS_CATALOG['capitulo-6'],
  SGC_CAPITULOS_CATALOG['capitulo-7'],
  SGC_CAPITULOS_CATALOG['capitulo-8'],
  SGC_CAPITULOS_CATALOG['capitulo-9'],
  SGC_CAPITULOS_CATALOG['capitulo-10']
];
