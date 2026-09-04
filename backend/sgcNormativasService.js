/**
 * Normativas oficiales (NOM-STPS y afines) — PDFs en Google Drive.
 * Carpeta: Documentos externos / Normativas.
 */

const path = require('path');
const driveService = require('./driveService');

const CARPETA_NORMATIVAS_ID =
    String(process.env.SGC_NORMATIVAS_DRIVE_FOLDER_ID || '').trim()
    || '1HDGYBfbi_wtgDNnaEHSwpHrRAUAUnvYY';

const CACHE_MS = 45 * 1000;
let cacheLista = { at: 0, documentos: null };

const TITULOS_NOM = {
    'NOM-001-STPS': 'Edificios, locales, instalaciones y áreas en los centros de trabajo',
    'NOM-002-STPS': 'Prevención y protección contra incendios',
    'NOM-003-STPS': 'Actividades agrícolas: uso de insumos fitosanitarios o plaguicidas',
    'NOM-004-STPS': 'Sistemas de protección y dispositivos de seguridad en la maquinaria',
    'NOM-005-STPS': 'Manejo, transporte y almacenamiento de sustancias químicas peligrosas',
    'NOM-006-STPS': 'Manejo y almacenamiento de materiales',
    'NOM-007-STPS': 'Actividades agrícolas: instalaciones, maquinaria, equipo y herramientas',
    'NOM-008-STPS': 'Actividades de aprovechamiento forestal maderable y de aserraderos',
    'NOM-009-STPS': 'Condiciones de seguridad para realizar trabajos en altura',
    'NOM-010-STPS': 'Agentes químicos contaminantes del ambiente laboral',
    'NOM-011-STPS': 'Condiciones de seguridad e higiene donde se genere ruido',
    'NOM-012-STPS': 'Fuentes de radiación ionizante',
    'NOM-013-STPS': 'Radiaciones electromagnéticas no ionizantes',
    'NOM-014-STPS': 'Exposición laboral a presiones ambientales anormales',
    'NOM-015-STPS': 'Condiciones térmicas elevadas o abatidas',
    'NOM-016-STPS': 'Exposición laboral a vibraciones',
    'NOM-017-STPS': 'Equipo de protección personal: selección, uso y manejo',
    'NOM-018-STPS': 'Sistema armonizado de identificación de sustancias químicas peligrosas',
    'NOM-019-STPS': 'Comisiones de seguridad e higiene',
    'NOM-020-STPS': 'Recipientes sujetos a presión y calderas',
    'NOM-022-STPS': 'Electricidad estática en los centros de trabajo',
    'NOM-023-STPS': 'Trabajos en minas subterráneas y a cielo abierto',
    'NOM-024-STPS': 'Vibraciones: condiciones de seguridad e higiene',
    'NOM-025-STPS': 'Condiciones de iluminación en los centros de trabajo',
    'NOM-026-STPS': 'Colores y señales de seguridad e higiene',
    'NOM-027-STPS': 'Actividades de soldadura y corte',
    'NOM-028-STPS': 'Seguridad en los procesos de sustancias químicas',
    'NOM-029-STPS': 'Mantenimiento de las instalaciones eléctricas',
    'NOM-030-STPS': 'Servicios preventivos de seguridad y salud en el trabajo',
    'NOM-031-STPS': 'Construcción: condiciones de seguridad y salud',
    'NOM-032-STPS': 'Seguridad para minas subterráneas de carbón',
    'NOM-033-STPS': 'Trabajos en espacios confinados',
    'NOM-034-STPS': 'Acceso y actividades de trabajadores con discapacidad',
    'NOM-035-STPS': 'Factores de riesgo psicosocial en el trabajo',
    'NOM-036-STPS': 'Factores de riesgo ergonómico en el trabajo',
    'NOM-036-1-STPS': 'Factores de riesgo ergonómico. Parte 1: manejo manual de cargas',
    'NOM-037-STPS': 'Teletrabajo: condiciones de seguridad y salud'
};

function invalidarCache() {
    cacheLista = { at: 0, documentos: null };
}

function esPdf(archivo) {
    const mime = String(archivo?.mimeType || '').toLowerCase();
    const nombre = String(archivo?.name || '').toLowerCase();
    return mime.includes('pdf') || nombre.endsWith('.pdf');
}

function parsearNombreNom(nombreArchivo) {
    const base = path.basename(String(nombreArchivo || ''), path.extname(String(nombreArchivo || '')));
    const limpio = base.replace(/_+\d{2}$/i, '').trim();
    const match = limpio.match(/^NOM-(\d+)(?:-(\d+))?-([A-Z0-9]+)-(\d{4})$/i);
    if (!match) {
        return {
            codigo: limpio || base,
            claveTitulo: '',
            numero: 9999,
            autoridad: '',
            anio: null
        };
    }
    const numero = Number(match[1]);
    const parte = match[2] ? `-${match[2]}` : '';
    const autoridad = String(match[3] || '').toUpperCase();
    const anio = Number(match[4]);
    const codigo = `NOM-${String(numero).padStart(3, '0')}${parte}-${autoridad}-${anio}`;
    const claveTitulo = `NOM-${String(numero).padStart(3, '0')}${parte}-${autoridad}`;
    return { codigo, claveTitulo, numero, autoridad, anio };
}

function categoriaDesdeNumero(numero) {
    if (numero >= 1 && numero <= 10) return 'nom-001-010';
    if (numero >= 11 && numero <= 20) return 'nom-011-020';
    if (numero >= 21 && numero <= 30) return 'nom-021-030';
    if (numero >= 31 && numero <= 40) return 'nom-031-040';
    return 'otras';
}

function tituloDe(parsed, nombreArchivo) {
    if (parsed.claveTitulo && TITULOS_NOM[parsed.claveTitulo]) {
        return TITULOS_NOM[parsed.claveTitulo];
    }
    if (parsed.claveTitulo) {
        const sinParte = parsed.claveTitulo.replace(/^(NOM-\d+)-\d+-([A-Z0-9]+)$/i, '$1-$2');
        if (sinParte !== parsed.claveTitulo && TITULOS_NOM[sinParte]) {
            return TITULOS_NOM[sinParte];
        }
    }
    return parsed.codigo || path.basename(String(nombreArchivo || ''), '.pdf');
}

function mapearArchivo(archivo) {
    const nombreArchivo = String(archivo.name || 'normativa.pdf');
    const parsed = parsearNombreNom(nombreArchivo);
    return {
        id: archivo.id,
        codigo: parsed.codigo,
        titulo: tituloDe(parsed, nombreArchivo),
        driveFileId: archivo.id,
        categoriaId: categoriaDesdeNumero(parsed.numero),
        nombreArchivo,
        mimeType: archivo.mimeType || 'application/pdf',
        tamanoBytes: archivo.size != null ? Number(archivo.size) : null,
        fechaModificacion: archivo.modifiedTime || null,
        autoridad: parsed.autoridad || null,
        anio: parsed.anio,
        numero: parsed.numero
    };
}

const CATALOGO_INICIAL = [
    { id: '1HWIXOy8-7TMPTHp_b-ljM1lSxvBBRQN3', name: 'NOM-001-STPS-2008.pdf', mimeType: 'application/pdf', size: 201190 },
    { id: '1zdUbTxpAQT5at5eUCrIQgagF8BruRbNt', name: 'NOM-002-STPS-2010.pdf', mimeType: 'application/pdf', size: 354852 },
    { id: '1U5O3TE8dR5g0_Ph16xnOMyj1gOquIg8S', name: 'NOM-003-STPS-2023.pdf', mimeType: 'application/pdf', size: 2000784 },
    { id: '1fdWs_YHGWtLEuV4cTvu3OUBvGllCuIKO', name: 'NOM-004-STPS-1999.pdf', mimeType: 'application/pdf', size: 39733 },
    { id: '16NRjwKCXOiDOOV-6VQ21LpyqLtWn1FM0', name: 'NOM-005-STPS-1998.pdf', mimeType: 'application/pdf', size: 79133 },
    { id: '1xH8urAmBjL2Cyl-2uZToFWk0qXZiFyff', name: 'NOM-006-STPS-2023.pdf', mimeType: 'application/pdf', size: 1284209 },
    { id: '1stViK4Vxkeu6VFbRUNEn12UXCagJhYKL', name: 'NOM-008-STPS-2013.pdf', mimeType: 'application/pdf', size: 508610 },
    { id: '10ggz1afFVNdaUc75t5Ln8K5X9c3uHipC', name: 'NOM-009-STPS-2011.pdf', mimeType: 'application/pdf', size: 383858 },
    { id: '1JDvoikltp0f4G3kFN8q8qvnPTmjw_VQk', name: 'NOM-010-STPS-2014.pdf', mimeType: 'application/pdf', size: 1633829 },
    { id: '1uzj-Fqf1mNhWqMp5fOVeKVwHVvR4uAo8', name: 'NOM-011-STPS-2001.pdf', mimeType: 'application/pdf', size: 181630 },
    { id: '1AAvUzB4eYuZW3AqT-UQznAbkxcEPLPbO', name: 'NOM-012-STPS-2012.pdf', mimeType: 'application/pdf', size: 203652 },
    { id: '1daUNuC61GlO28qo20DJGl_FJjyTF2mUK', name: 'NOM-013-STPS-1993.pdf', mimeType: 'application/pdf', size: 87103 },
    { id: '1jQZ49hcyxTBW_WTrm6P6oJL51fB-ulHa', name: 'NOM-014-STPS-2000.pdf', mimeType: 'application/pdf', size: 1224490 },
    { id: '1j_n_yBH6-vJoDaEWc2OtQinEpWQ12gZd', name: 'NOM-015-STPS-2001.pdf', mimeType: 'application/pdf', size: 273768 },
    { id: '1FR5ZCnV_tPGnVQCgI1BSCfCv3UvSb0GR', name: 'NOM-016-STPS-2001.pdf', mimeType: 'application/pdf', size: 78940 },
    { id: '1UGM828x3n9ygFos-_bQIfS4gMT4hMREG', name: 'NOM-017-STPS-2024.pdf', mimeType: 'application/pdf', size: 746119 },
    { id: '1l_40A47P52szNz7lOjDJqdVnTZY5H7kb', name: 'NOM-018-STPS-2015.pdf', mimeType: 'application/pdf', size: 1064020 },
    { id: '1-r6C7A2s4MTBga8HpnufQ-Z4zCeYc1zL', name: 'NOM-019-STPS-2011.pdf', mimeType: 'application/pdf', size: 183571 },
    { id: '12jZRa1C3Y3tbpqBhJhxg1U-M3H9Pqkqz', name: 'NOM-020-STPS-2011.pdf', mimeType: 'application/pdf', size: 2017065 },
    { id: '1ysGq4oNVRQzjsOeUXNr6y47FUeZIYPQ2', name: 'NOM-022-STPS-2015.pdf', mimeType: 'application/pdf', size: 418718 },
    { id: '1wQvddQThgDUQz3Nzs-JVJAR9lnjWwRvx', name: 'NOM-023-STPS-2012.pdf', mimeType: 'application/pdf', size: 1006708 },
    { id: '1omdAhuUM_iZzR55yU-XAaHqWZ1QbnC3G', name: 'NOM-024-STPS-2001.pdf', mimeType: 'application/pdf', size: 737832 },
    { id: '1uZ8Djsl0DaDhN9bBqLNgxecfJga3nFs-', name: 'NOM-025-STPS-2008.pdf', mimeType: 'application/pdf', size: 130820 },
    { id: '1BCb-bsMjm-lfe3dHdCqxGMyaUlWsFW0y', name: 'NOM-026-STPS-2008.pdf', mimeType: 'application/pdf', size: 503696 },
    { id: '1YNanF0qrcUKQFj0oCAH7EkKJhLpPpYDa', name: 'NOM-027-STPS-2008.pdf', mimeType: 'application/pdf', size: 165568 },
    { id: '1I6GszZ2HAhcy8HFP19Gifc_IuvrDnzjf', name: 'NOM-028-STPS-2012.pdf', mimeType: 'application/pdf', size: 441146 },
    { id: '10Wzt9O20J8JTp_hh6pmyG6m_FEcS2qvc', name: 'NOM-029-STPS-2011.pdf', mimeType: 'application/pdf', size: 225346 },
    { id: '1zL6w--fAO67ysXvGQ5vBb3rGvLdY_TXe', name: 'NOM-030-STPS-2009.pdf', mimeType: 'application/pdf', size: 87060 },
    { id: '1yqtQzuicj3Puw3IEjdFGN7At2XNlj_D9', name: 'NOM-031-STPS-2011.pdf', mimeType: 'application/pdf', size: 363882 },
    { id: '1gp38TYjgvvoRPSD8xklA1ZeEblBx5TLi', name: 'NOM-032-STPS-2008.pdf', mimeType: 'application/pdf', size: 414509 },
    { id: '1FnrvpIqqfTt77drDIsv6NtwlxCr58UlC', name: 'NOM-033-STPS-2015.pdf', mimeType: 'application/pdf', size: 451856 },
    { id: '1bRuftdiUV8nXxlxy8WdK1uqPt3oz7W4e', name: 'NOM-034-STPS-2016.pdf', mimeType: 'application/pdf', size: 142047 },
    { id: '1samgvxIua_BgFFQq8peGB82fzemP7XFi', name: 'NOM-035-STPS-2018.pdf', mimeType: 'application/pdf', size: 731568 },
    { id: '1NziuSU7_HcEBqAMBSMxtnZf6uNZ3n7uU', name: 'NOM-036-1-STPS-2018.pdf', mimeType: 'application/pdf', size: 902841 },
    { id: '1x2IpTjOfHaQ0jDhY7T9ffgfBBu3_WE4E', name: 'NOM-037-STPS-2023.pdf', mimeType: 'application/pdf', size: 2244553 }
];

function ordenarDocumentos(documentos) {
    return documentos.sort((a, b) => {
        if (a.numero !== b.numero) return a.numero - b.numero;
        return String(a.codigo).localeCompare(String(b.codigo), 'es');
    });
}

function documentosDesdeCatalogo() {
    return ordenarDocumentos(CATALOGO_INICIAL.map(mapearArchivo));
}

async function listarNormativas() {
    const ahora = Date.now();
    if (cacheLista.documentos && (ahora - cacheLista.at) < CACHE_MS) {
        return cacheLista.documentos;
    }

    try {
        const archivos = await driveService.listarArchivosCarpeta(CARPETA_NORMATIVAS_ID);
        const documentos = ordenarDocumentos(
            (archivos || []).filter(esPdf).map(mapearArchivo)
        );
        if (!documentos.length) {
            console.warn('[SGC-NORM] Drive no devolvió PDFs; se usa el catálogo local.');
            return documentosDesdeCatalogo();
        }
        cacheLista = { at: ahora, documentos };
        return documentos;
    } catch (error) {
        console.warn('[SGC-NORM] No se pudo listar Drive, se usa catálogo local:', error.message || error);
        return documentosDesdeCatalogo();
    }
}

async function asegurarArchivoEnCarpeta(fileId) {
    const id = String(fileId || '').trim();
    if (!id) {
        throw Object.assign(new Error('El identificador del archivo es obligatorio'), { status: 400 });
    }
    const meta = await driveService.obtenerMetadatosArchivo(id);
    if (!meta || meta.trashed) {
        throw Object.assign(new Error('No se encontró el archivo en Drive'), { status: 404 });
    }
    const parents = Array.isArray(meta.parents) ? meta.parents : [];
    if (!parents.includes(CARPETA_NORMATIVAS_ID)) {
        throw Object.assign(new Error('El archivo no pertenece a la carpeta de normativas'), { status: 403 });
    }
    return meta;
}

async function reemplazarNormativa(fileId, buffer, mimeType, nombreOriginal) {
    if (!buffer || !buffer.length) {
        throw Object.assign(new Error('Debe adjuntar un archivo PDF'), { status: 400 });
    }
    const mime = String(mimeType || '').toLowerCase();
    const ext = path.extname(String(nombreOriginal || '')).toLowerCase();
    if (!mime.includes('pdf') && ext !== '.pdf') {
        throw Object.assign(new Error('Solo se permiten archivos PDF'), { status: 400 });
    }

    const meta = await asegurarArchivoEnCarpeta(fileId);
    const nombre = meta.name || String(nombreOriginal || 'normativa.pdf');
    const actualizado = await driveService.reemplazarArchivoEnDrive(
        meta.id,
        buffer,
        'application/pdf',
        nombre
    );

    try {
        await driveService.asignarPermisoLecturaPublica(meta.id);
    } catch (permErr) {
        console.warn('[SGC-NORM] No se pudo republicar lectura del PDF:', permErr.message);
    }

    invalidarCache();
    return mapearArchivo({
        id: actualizado?.id || meta.id,
        name: actualizado?.name || nombre,
        mimeType: actualizado?.mimeType || 'application/pdf',
        size: actualizado?.size || buffer.length,
        modifiedTime: actualizado?.modifiedTime || new Date().toISOString()
    });
}

module.exports = {
    CARPETA_NORMATIVAS_ID,
    listarNormativas,
    reemplazarNormativa,
    invalidarCache
};
