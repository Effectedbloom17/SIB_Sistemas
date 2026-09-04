require('dotenv').config({ path: require('path').join(__dirname, '.env'), quiet: true });
const { google } = require('googleapis');
const fs = require('fs');
const path = require('path');

const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
const GOOGLE_REFRESH_TOKEN = process.env.GOOGLE_REFRESH_TOKEN;
const ROOT_FOLDER_ID = process.env.GOOGLE_DRIVE_FOLDER_ID;
const FORMS_TEMPLATE_ID = process.env.GOOGLE_FORMS_TEMPLATE_ID || null;

let drive;
let forms;
let authMethod = 'none';

if (GOOGLE_CLIENT_ID && GOOGLE_CLIENT_SECRET && GOOGLE_REFRESH_TOKEN) {
    const oauth2Client = new google.auth.OAuth2(GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET);
    oauth2Client.setCredentials({ refresh_token: GOOGLE_REFRESH_TOKEN });
    drive = google.drive({ version: 'v3', auth: oauth2Client });
    forms = google.forms({ version: 'v1', auth: oauth2Client });
    authMethod = 'oauth2';
} else {
    const CREDENTIALS_PATH = path.join(__dirname, process.env.GOOGLE_CREDENTIALS_PATH || './google-credentials.json');

    if (!fs.existsSync(CREDENTIALS_PATH)) {
        const esProduccion = String(process.env.NODE_ENV || '').toLowerCase() === 'production';
        if (esProduccion) {
            throw new Error('No se encontró configuración de autenticación de Google para Forms');
        }

        console.warn('[WARN] Google Forms no configurado — encuestas y formularios no estarán disponibles.');
        console.warn('   Configura OAuth2 o coloca Service Account en:', CREDENTIALS_PATH);
        authMethod = 'none';
    } else {
        const credentials = JSON.parse(fs.readFileSync(CREDENTIALS_PATH, 'utf-8'));
        const auth = new google.auth.GoogleAuth({
            credentials,
            scopes: [
                'https://www.googleapis.com/auth/drive',
                'https://www.googleapis.com/auth/forms.body',
                'https://www.googleapis.com/auth/forms.responses.readonly'
            ]
        });

        drive = google.drive({ version: 'v3', auth });
        forms = google.forms({ version: 'v1', auth });
        authMethod = 'service-account';
    }
}

function limpiarTexto(texto, fallback = '') {
    return (texto || fallback || '').toString().trim();
}

function construirPreguntasBase() {
    return [
        {
            title: '¿Cuál fue el enfoque del curso de capacitación que recibiste?',
            required: true,
            type: 'CHECKBOX',
            options: ['Seguridad e higiene industrial', 'Ambiental', 'Salud', 'Sistema de Gestión ISO']
        },
        {
            title: '¿Cómo evalúa, en términos generales, el curso de capacitación?',
            required: true,
            type: 'RADIO',
            options: ['Excelente', 'Bueno', 'Regular', 'Malo']
        },
        {
            title: '¿Cómo considera la pertinencia de los temas abordados durante la capacitación?',
            required: true,
            type: 'RADIO',
            options: ['Excelente', 'Bueno', 'Regular', 'Malo']
        },
        {
            title: '¿Cómo evalúa la atención y el desempeño del instructor durante el desarrollo del curso?',
            required: true,
            type: 'RADIO',
            options: ['Excelente', 'Bueno', 'Regular', 'Malo']
        },
        {
            title: 'Considera que el dominio de los temas por parte del instructor fue:',
            required: true,
            type: 'RADIO',
            options: ['Excelente', 'Bueno', 'Regular', 'Malo']
        },
        {
            title: '¿Recomendaría a Biznaga para impartir esta capacitación?',
            required: true,
            type: 'RADIO',
            options: ['Definitivamente sí', 'Definitivamente no']
        },
        {
            title: 'Deja tu comentario sobre cómo podríamos mejorar nuestro servicio de capacitación en Biznaga',
            required: false,
            paragraph: true
        }
    ];
}

function construirRequestsPreguntas(preguntas, startIndex = 0) {
    const requests = [];

    preguntas.forEach((pregunta, idx) => {
        const location = { index: startIndex + idx };

        if (pregunta.paragraph) {
            requests.push({
                createItem: {
                    item: {
                        title: pregunta.title,
                        questionItem: {
                            question: {
                                required: !!pregunta.required,
                                textQuestion: { paragraph: true }
                            }
                        }
                    },
                    location
                }
            });
            return;
        }

        requests.push({
            createItem: {
                item: {
                    title: pregunta.title,
                    questionItem: {
                        question: {
                            required: !!pregunta.required,
                            choiceQuestion: {
                                type: pregunta.type || 'RADIO',
                                options: (pregunta.options || []).map((option) => ({ value: option })),
                                shuffle: false
                            }
                        }
                    }
                },
                location
            }
        });
    });

    return requests;
}

function construirRequestNoRecolectarCorreo() {
    return {
        updateSettings: {
            settings: {
                emailCollectionType: 'DO_NOT_COLLECT'
            },
            updateMask: 'emailCollectionType'
        }
    };
}

function esPreguntaCorreoOTrazaPersonal(title) {
    const texto = (title || '').toString().normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
    return /\b(correo|email|e-mail|mail)\b/.test(texto);
}

function construirRequestsEliminarPreguntasCorreo(formData) {
    const items = formData?.items || [];
    const requests = [];

    for (let index = items.length - 1; index >= 0; index--) {
        const item = items[index];
        if (!item?.questionItem?.question) continue;
        if (!esPreguntaCorreoOTrazaPersonal(item?.title || '')) continue;

        requests.push({
            deleteItem: {
                location: { index }
            }
        });
    }

    return requests;
}

async function moverArchivoACarpeta(fileId, folderId) {
    if (!folderId) return;

    const current = await drive.files.get({ fileId, fields: 'id, parents' });
    const previousParents = (current.data.parents || []).join(',');

    await drive.files.update({
        fileId,
        addParents: folderId,
        removeParents: previousParents || undefined,
        fields: 'id, parents'
    });
}

async function hacerPublicoLectura(fileId) {
    try {
        await drive.permissions.create({
            fileId,
            requestBody: {
                role: 'reader',
                type: 'anyone',
                view: 'published'
            }
        });
    } catch (error) {
        try {
            // Fallback para entornos donde el campo view no esté soportado
            await drive.permissions.create({
                fileId,
                requestBody: {
                    role: 'reader',
                    type: 'anyone'
                }
            });
        } catch (fallbackError) {
            console.warn('[WARN] No se pudo hacer público el formulario:', fallbackError.message);
        }
    }
}

async function configurarPublicacionAbierta(formId) {
    // Intentar publicar el formulario (necesario especialmente para copias vía Drive)
    for (let intento = 1; intento <= 3; intento++) {
        try {
            await forms.forms.setPublishSettings({
                formId,
                requestBody: {
                    publishSettings: {
                        publishState: {
                            isPublished: true,
                            isAcceptingResponses: true
                        }
                    }
                }
            });
            return; // Éxito
        } catch (error) {
            if (intento < 3) {
                // Esperar antes de reintentar (el form puede no estar listo aún tras la copia)
                await new Promise(r => setTimeout(r, 1000 * intento));
            } else {
                console.warn('[WARN] No se pudo ajustar publishSettings del formulario tras 3 intentos:', error.message);
            }
        }
    }
}

async function cerrarFormularioEncuesta(formId) {
    try {
        await forms.forms.setPublishSettings({
            formId,
            requestBody: {
                publishSettings: {
                    publishState: {
                        isPublished: false,
                        isAcceptingResponses: false
                    }
                }
            }
        });
    } catch (error) {
        console.warn('[WARN] No se pudo cerrar publicación/recepción del formulario:', error.message);
    }
}

async function obtenerMetaFormulario(formId) {
    const [formData, driveData] = await Promise.all([
        forms.forms.get({ formId }),
        drive.files.get({ fileId: formId, fields: 'id, name, webViewLink, trashed' })
    ]);

    return {
        form_id: formId,
        titulo: formData.data?.info?.title || driveData.data?.name || '',
        descripcion: formData.data?.info?.description || '',
        encuesta_url: formData.data?.responderUri || '',
        encuesta_edit_url: `https://docs.google.com/forms/d/${formId}/edit`,
        drive_web_view_link: driveData.data?.webViewLink || '',
        trashed: !!driveData.data?.trashed
    };
}

function extraerPreguntasDeFormulario(formData) {
    const items = formData?.items || [];
    const preguntas = [];

    for (const item of items) {
        const pregunta = item?.questionItem?.question;
        if (!pregunta?.questionId) continue;

        const title = item?.title || 'Pregunta';

        if (pregunta.choiceQuestion?.options?.length) {
            preguntas.push({
                questionId: pregunta.questionId,
                title,
                type: 'choice',
                options: pregunta.choiceQuestion.options.map((opt) => opt?.value).filter(Boolean)
            });
            continue;
        }

        if (pregunta.textQuestion) {
            preguntas.push({
                questionId: pregunta.questionId,
                title,
                type: 'text',
                paragraph: !!pregunta.textQuestion.paragraph
            });
        }
    }

    return preguntas;
}

function construirRequestDesdePreguntaTemplate(pregunta, index) {
    const location = { index };

    if (pregunta.type === 'choice') {
        return {
            createItem: {
                item: {
                    title: pregunta.title,
                    questionItem: {
                        question: {
                            required: !!pregunta.required,
                            choiceQuestion: {
                                type: pregunta.choiceType || 'RADIO',
                                options: (pregunta.options || []).map((value) => ({ value })),
                                shuffle: !!pregunta.shuffle
                            }
                        }
                    }
                },
                location
            }
        };
    }

    return {
        createItem: {
            item: {
                title: pregunta.title,
                questionItem: {
                    question: {
                        required: !!pregunta.required,
                        textQuestion: {
                            paragraph: !!pregunta.paragraph
                        }
                    }
                }
            },
            location
        }
    };
}

function extraerPreguntasPlantilla(formData) {
    const items = formData?.items || [];
    const preguntas = [];

    for (const item of items) {
        const question = item?.questionItem?.question;
        if (!question) continue;

        if (esPreguntaCorreoOTrazaPersonal(item?.title || '')) {
            continue;
        }

        if (question.choiceQuestion?.options?.length) {
            preguntas.push({
                title: item?.title || 'Pregunta',
                required: !!question.required,
                type: 'choice',
                choiceType: question.choiceQuestion.type || 'RADIO',
                shuffle: !!question.choiceQuestion.shuffle,
                options: question.choiceQuestion.options.map((opt) => opt?.value).filter(Boolean)
            });
            continue;
        }

        if (question.textQuestion) {
            preguntas.push({
                title: item?.title || 'Pregunta',
                required: !!question.required,
                type: 'text',
                paragraph: !!question.textQuestion.paragraph
            });
        }
    }

    return preguntas;
}

async function listarRespuestasFormulario(formId, pageSize = 5000) {
    let nextPageToken = undefined;
    const allResponses = [];

    do {
        const response = await forms.forms.responses.list({
            formId,
            pageSize,
            pageToken: nextPageToken
        });

        const responses = response.data?.responses || [];
        allResponses.push(...responses);
        nextPageToken = response.data?.nextPageToken;
    } while (nextPageToken);

    return allResponses;
}

const DESCRIPCION_ENCUESTA_DEFAULT = 'En Biznaga Risk and Tech estamos comprometidos con la mejora continua y con el cumplimiento de las necesidades y expectativas de nuestros clientes. Valoramos profundamente su opinión respecto a nuestro servicio de capacitación, por lo que le solicitamos su colaboración para responder el siguiente cuestionario. Sus respuestas nos permitirán identificar áreas de oportunidad y fortalecer los aspectos señalados.\n\nCódigo: SP-F-14 | Revisión: 00 | Fecha de revisión: 24-01-25';

async function copiarFormularioDesdeTemplate(templateId, nuevoTitulo, folderId) {
    const copied = await drive.files.copy({
        fileId: templateId,
        requestBody: {
            name: nuevoTitulo
        },
        fields: 'id, name'
    });

    const formId = copied.data.id;

    // Actualizar título y descripción vía Forms API (el copy preserva color e imagen)
    await forms.forms.batchUpdate({
        formId,
        requestBody: {
            requests: [
                {
                    updateFormInfo: {
                        info: { title: nuevoTitulo },
                        updateMask: 'title'
                    }
                },
                construirRequestNoRecolectarCorreo()
            ]
        }
    });

    await moverArchivoACarpeta(formId, folderId || ROOT_FOLDER_ID);
    await hacerPublicoLectura(formId);
    await configurarPublicacionAbierta(formId);

    return await obtenerMetaFormulario(formId);
}

async function crearFormularioEncuesta({ titulo, descripcion, folderId }) {
    const tituloFinal = limpiarTexto(titulo, 'Instrumento de satisfacción del curso');

    // Si hay plantilla configurada, copiarla para preservar color e imagen de encabezado
    if (FORMS_TEMPLATE_ID) {
        try {
            const existe = await verificarFormularioExiste(FORMS_TEMPLATE_ID);
            if (existe) {
                return await copiarFormularioDesdeTemplate(FORMS_TEMPLATE_ID, tituloFinal, folderId);
            }
        } catch (tplErr) {
            console.warn('[WARN] No se pudo copiar plantilla de encuesta, creando desde cero:', tplErr.message);
        }
    }

    // Fallback: crear desde cero (sin estilos visuales)
    const descripcionFinal = limpiarTexto(descripcion, DESCRIPCION_ENCUESTA_DEFAULT);

    const created = await forms.forms.create({
        requestBody: {
            info: {
                title: tituloFinal,
                documentTitle: tituloFinal
            }
        }
    });

    const formId = created.data.formId;

    const requests = [
        {
            updateFormInfo: {
                info: {
                    title: tituloFinal,
                    description: descripcionFinal
                },
                updateMask: 'title,description'
            }
        },
        construirRequestNoRecolectarCorreo(),
        ...construirRequestsPreguntas(construirPreguntasBase(), 0)
    ];

    await forms.forms.batchUpdate({
        formId,
        requestBody: { requests }
    });

    await moverArchivoACarpeta(formId, folderId || ROOT_FOLDER_ID);
    await hacerPublicoLectura(formId);
    await configurarPublicacionAbierta(formId);

    return await obtenerMetaFormulario(formId);
}

async function clonarFormularioEncuesta({ templateFormId, titulo, descripcion, folderId }) {
    const tituloFinal = limpiarTexto(titulo, 'Instrumento de satisfacción del curso');

    // Prioridad: 1) plantilla global (tiene estilos), 2) plantilla del curso, 3) crear desde cero
    const templateParaCopiar = FORMS_TEMPLATE_ID || templateFormId;

    if (templateParaCopiar) {
        try {
            const existe = await verificarFormularioExiste(templateParaCopiar);
            if (existe) {
                return await copiarFormularioDesdeTemplate(templateParaCopiar, tituloFinal, folderId);
            }
        } catch (copyErr) {
            console.warn('[WARN] No se pudo copiar formulario plantilla, creando desde cero:', copyErr.message);
        }
    }

    // Fallback: crear desde cero usando las preguntas de la plantilla del curso
    let preguntasFinales = construirPreguntasBase();
    if (templateFormId) {
        try {
            const plantilla = await forms.forms.get({ formId: templateFormId });
            const preguntasTemplate = extraerPreguntasPlantilla(plantilla.data);
            if (preguntasTemplate.length > 0) preguntasFinales = preguntasTemplate;
        } catch (e) {
            console.warn('[WARN] No se pudieron extraer preguntas de plantilla:', e.message);
        }
    }

    const descripcionFinal = limpiarTexto(descripcion, DESCRIPCION_ENCUESTA_DEFAULT);

    const created = await forms.forms.create({
        requestBody: {
            info: {
                title: tituloFinal,
                documentTitle: tituloFinal
            }
        }
    });

    const formId = created.data.formId;

    const requests = [
        {
            updateFormInfo: {
                info: {
                    title: tituloFinal,
                    description: descripcionFinal
                },
                updateMask: 'title,description'
            }
        },
        construirRequestNoRecolectarCorreo(),
        ...preguntasFinales.map((pregunta, idx) => construirRequestDesdePreguntaTemplate(pregunta, idx))
    ];

    await forms.forms.batchUpdate({
        formId,
        requestBody: { requests }
    });

    await moverArchivoACarpeta(formId, folderId || ROOT_FOLDER_ID);
    await hacerPublicoLectura(formId);
    await configurarPublicacionAbierta(formId);

    return await obtenerMetaFormulario(formId);
}

async function actualizarFormularioEncuesta({ formId, titulo, descripcion, regenerarPlantilla = false }) {
    const requests = [construirRequestNoRecolectarCorreo()];
    const formActual = await forms.forms.get({ formId });

    const tituloFinal = titulo !== undefined ? limpiarTexto(titulo, 'Instrumento de satisfacción del curso') : undefined;
    const descripcionFinal = descripcion !== undefined ? limpiarTexto(descripcion, '') : undefined;

    if (tituloFinal !== undefined || descripcionFinal !== undefined) {
        const info = {};
        const campos = [];

        if (tituloFinal !== undefined) {
            info.title = tituloFinal;
            campos.push('title');
        }

        if (descripcionFinal !== undefined) {
            info.description = descripcionFinal;
            campos.push('description');
        }

        requests.push({
            updateFormInfo: {
                info,
                updateMask: campos.join(',')
            }
        });
    }

    if (!regenerarPlantilla) {
        requests.push(...construirRequestsEliminarPreguntasCorreo(formActual.data));
    }

    if (regenerarPlantilla) {
        const items = formActual.data?.items || [];

        for (let index = items.length - 1; index >= 0; index--) {
            requests.push({
                deleteItem: {
                    location: { index }
                }
            });
        }

        requests.push(...construirRequestsPreguntas(construirPreguntasBase(), 0));
    }

    if (requests.length > 0) {
        await forms.forms.batchUpdate({
            formId,
            requestBody: { requests }
        });
    }

    await hacerPublicoLectura(formId);
    await configurarPublicacionAbierta(formId);

    return await obtenerMetaFormulario(formId);
}

async function eliminarFormularioEncuesta(formId, permanent = false) {
    if (permanent) {
        await drive.files.delete({ fileId: formId });
        return { deleted: true, permanent: true };
    }

    await drive.files.update({
        fileId: formId,
        requestBody: { trashed: true }
    });

    return { deleted: true, permanent: false };
}

async function verificarFormularioExiste(formId) {
    try {
        const file = await drive.files.get({ fileId: formId, fields: 'id, trashed' });
        return !!file.data?.id && !file.data?.trashed;
    } catch (error) {
        if (error.code === 404 || error.message?.includes('not found')) {
            return false;
        }
        throw error;
    }
}

async function obtenerEstadisticasFormulario(formId) {
    const [formData, responses] = await Promise.all([
        forms.forms.get({ formId }),
        listarRespuestasFormulario(formId)
    ]);

    const preguntas = extraerPreguntasDeFormulario(formData.data);
    const preguntasMap = new Map();

    for (const pregunta of preguntas) {
        if (pregunta.type === 'choice') {
            preguntasMap.set(pregunta.questionId, {
                question_id: pregunta.questionId,
                title: pregunta.title,
                type: 'choice',
                total_respuestas: 0,
                options: (pregunta.options || []).map((label) => ({ label, count: 0, percent: 0 }))
            });
        } else {
            preguntasMap.set(pregunta.questionId, {
                question_id: pregunta.questionId,
                title: pregunta.title,
                type: 'text',
                total_respuestas: 0,
                muestras_texto: []
            });
        }
    }

    for (const response of responses) {
        const answers = response?.answers || {};
        for (const answer of Object.values(answers)) {
            const questionId = answer?.questionId;
            if (!questionId || !preguntasMap.has(questionId)) continue;

            const question = preguntasMap.get(questionId);
            const valores = (answer?.textAnswers?.answers || []).map((a) => (a?.value || '').trim()).filter(Boolean);
            if (!valores.length) continue;

            question.total_respuestas += 1;

            if (question.type === 'choice') {
                for (const valor of valores) {
                    let option = question.options.find((opt) => opt.label === valor);
                    if (!option) {
                        option = { label: valor, count: 0, percent: 0 };
                        question.options.push(option);
                    }
                    option.count += 1;
                }
            } else {
                for (const valor of valores) {
                    if (question.muestras_texto.length < 5) {
                        question.muestras_texto.push(valor);
                    }
                }
            }
        }
    }

    for (const question of preguntasMap.values()) {
        if (question.type === 'choice') {
            const total = question.total_respuestas || 1;
            question.options = question.options
                .map((opt) => ({
                    ...opt,
                    percent: Math.round((opt.count / total) * 100)
                }))
                .sort((a, b) => b.count - a.count);
        }
    }

    const ultimaRespuesta = responses
        .map((r) => r.lastSubmittedTime || r.createTime)
        .filter(Boolean)
        .sort()
        .pop() || null;

    return {
        form_id: formId,
        total_respuestas: responses.length,
        ultima_respuesta: ultimaRespuesta,
        preguntas: Array.from(preguntasMap.values())
    };
}

/**
 * Devuelve la estructura del formulario + respuestas crudas (con timestamps).
 * Útil para agregaciones por mes / año (p. ej. SGC-F-26 Satisfacción del cliente).
 */
async function obtenerFormularioConRespuestas(formId) {
    const [formData, responses] = await Promise.all([
        forms.forms.get({ formId }),
        listarRespuestasFormulario(formId)
    ]);

    return {
        form_id: formId,
        info: formData.data?.info || {},
        preguntas: extraerPreguntasDeFormulario(formData.data),
        responses: responses || []
    };
}

module.exports = {
    crearFormularioEncuesta,
    clonarFormularioEncuesta,
    copiarFormularioDesdeTemplate,
    actualizarFormularioEncuesta,
    cerrarFormularioEncuesta,
    eliminarFormularioEncuesta,
    obtenerMetaFormulario,
    obtenerEstadisticasFormulario,
    obtenerFormularioConRespuestas,
    listarRespuestasFormulario,
    verificarFormularioExiste,
    FORMS_TEMPLATE_ID,
    authMethod
};
