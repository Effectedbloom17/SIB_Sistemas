/**
 * Fusiona la intro (sección 1) con «Tus datos» (sección 2) del formulario CBT
 * y mejora textos de secciones restantes.
 *
 * Uso: node scripts/actualizar-formulario-cbt-inscripcion.js
 * Env: CBT_INSCRIPCION_FORM_ID (default: formulario CBT José Antonio Alzate)
 */
require('dotenv').config({ path: require('path').join(__dirname, '../.env'), quiet: true });
const { google } = require('googleapis');

const DEFAULT_FORM_ID = '1y3yDwuDp839XBJd40aTdaMziYJJiLugjjKPTcYd4WMY';

const oauth2 = new google.auth.OAuth2(
  process.env.GOOGLE_CLIENT_ID,
  process.env.GOOGLE_CLIENT_SECRET
);
oauth2.setCredentials({ refresh_token: process.env.GOOGLE_REFRESH_TOKEN });
const forms = google.forms({ version: 'v1', auth: oauth2 });

const INTRO_DESCRIPCION = [
  'Formulario de inscripción para aspirantes del CBT José Antonio Alzate.',
  '',
  'Comienza con tus datos personales (abajo). Después continuarás con domicilio, padres o tutor, salud y documentos obligatorios.',
  '',
  'Importante: usa información real y revisa cada campo antes de enviar.',
  '',
  '— Tus datos —',
  'Completa con información real.'
].join('\n');

/** Textos con marcadores *cursiva* para resaltar en el editor (aplicar formato manual si hace falta). */
const SECCIONES = {
  'Tu domicilio': {
    title: 'Tu domicilio',
    description:
      'Indica *dónde vives actualmente*. Si no coincide con el comprobante, sube el documento correcto en la sección de archivos.'
  },
  'Datos de tus padres o tutor': {
    title: 'Datos de tus padres o tutor',
    description:
      'Contacto de *mamá, papá o tutor*. Revisa el *Reglamento del CBT* antes de continuar.'
  },
  'Tu salud': {
    title: 'Tu salud',
    description:
      'Información médica para *emergencias* y actividades escolares. Si no tienes alergias o padecimientos, indícalo.'
  },
  'Documentos obligatorios': {
    title: 'Documentos obligatorios',
    description:
      'Sube archivos en *PDF o imagen*, legibles y completos. Nombre sugerido: *TipoDocumento_NombreApellido.pdf*'
  }
};

function indicePageBreakTusDatos(items = []) {
  return items.findIndex(
    (it) =>
      it.pageBreakItem &&
      String(it.title || '')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .includes('tus datos')
  );
}

async function main() {
  const formId = String(process.env.CBT_INSCRIPCION_FORM_ID || DEFAULT_FORM_ID).trim();
  const form = await forms.forms.get({ formId });
  const items = form.data.items || [];
  const idxTusDatos = indicePageBreakTusDatos(items);

  const requests = [];

  if (idxTusDatos >= 0) {
    requests.push({
      updateFormInfo: {
        info: { description: INTRO_DESCRIPCION },
        updateMask: 'description'
      }
    });
    requests.push({
      deleteItem: { location: { index: idxTusDatos } }
    });
    console.log(`Fusionando intro con «Tus datos» (elimina page break índice ${idxTusDatos})`);
    await forms.forms.batchUpdate({ formId, requestBody: { requests } });
  } else {
    console.log('«Tus datos» ya fusionado con la intro.');
  }

  const form2 = await forms.forms.get({ formId });
  const requestsSecciones = [];

  (form2.data.items || []).forEach((it, index) => {
    if (!it.pageBreakItem) return;
    const cfg = SECCIONES[it.title];
    if (!cfg) return;
    requestsSecciones.push({
      updateItem: {
        item: {
          itemId: it.itemId,
          title: cfg.title,
          description: cfg.description,
          pageBreakItem: {}
        },
        location: { index },
        updateMask: 'title,description'
      }
    });
  });

  if (requestsSecciones.length) {
    await forms.forms.batchUpdate({ formId, requestBody: { requests: requestsSecciones } });
    console.log(`Actualizadas ${requestsSecciones.length} secciones con textos mejorados.`);
  }

  console.log('Listo. Formulario:', formId);
  console.log('Abre el formulario en Google Forms y aplica negritas/cursivas donde ves *asteriscos* si lo deseas.');
}

main().catch((e) => {
  console.error(e.message || e);
  process.exit(1);
});
