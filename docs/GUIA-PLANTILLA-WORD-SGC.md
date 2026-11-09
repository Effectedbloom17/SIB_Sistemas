# Guía: plantilla Word externa → documento dinámico del sistema (SGC)

Checklist para implementar en **otro formato Word** la misma idea que DG-F-02 (referencia vigente):  
diseño en un Google Doc **plantilla** (aparte) y trabajo en un Google Doc **sistema** (dinámico).  
Los Words anteriores no se borran: se mueven a la carpeta **Historial de Versiones**.

No cubre reglas de diseño (márgenes, fuentes, logo, pie). Solo el flujo de archivos, placeholders y sync.

Paralelo Excel: `docs/GUIA-PLANTILLA-EXCEL-SGC.md` (allá el historial vive en pestañas; aquí vive en archivos).

---

## 1. Datos que debes proporcionar (rellenar antes de codear)

### A) Documento dinámico del sistema (Word de trabajo)

| Campo | Valor |
| --- | --- |
| Nombre / código del formato | _ej. DG-F-02_ |
| Carpeta Drive de **trabajo** | _link de la carpeta donde vive el Word vigente_ |
| ID de esa carpeta | |
| Nombre del archivo sistema | _ej. `DG-F-02 Alcance (sistema).docx`_ |
| Carpeta Drive de **historial** | _link de “Historial de Versiones”_ |
| ID de la carpeta de historial | |
| Nombre al archivar | _`CODIGO Nombre (sistema) - Rev NN - AAAAMMDD.docx`_ |

El sistema **no** usa un Google Doc fijo como “libro sistema”.  
Cada regeneración crea un archivo nuevo en la carpeta de trabajo y mueve el anterior al historial.

### B) Archivo plantilla (Word externo, solo diseño)

| Campo | Valor |
| --- | --- |
| Link del Google Doc **plantilla** | |
| ID de Drive (entre `/d/` y `/edit`) | |
| ¿La plantilla se edita a mano en Drive? | Sí — el sistema **solo la lee y la copia** |
| Placeholders de cabecera | `{{codigo}}` `{{num_rev}}` `{{fecha}}` |
| Placeholders de cuerpo | _listar cada uno, ej. `{{texto_alcance}}`_ |

Ejemplo de link plantilla:

`https://docs.google.com/document/d/________________________/edit`

En el Word la cabecera debe quedar escrita así (el sistema reemplaza solo lo que está entre llaves):

```
Código: {{codigo}}     No. Rev: {{num_rev}}     Fecha: {{fecha}}
```

### C) Reglas fijas (no negociar)

1. **Nunca** escribir datos de negocio ni reemplazar texto dentro del archivo plantilla.
2. **Nunca** usar el ID de la plantilla como documento de trabajo en BD.
3. El historial (Words ya archivados) **no se regenera** ni se borra. Solo se mueve el Word vigente cuando toca regenerar.
4. La cuenta Drive del backend debe tener lectura de la plantilla y edición de las dos carpetas (trabajo + historial).
5. **Código, No. Rev y Fecha** salen de la **Lista Maestra** (SGC-F-01 / `sgc_formato_metadatos`). Un guardado del alcance **no** sube la revisión.
6. `{{fecha}}` es la **fecha de revisión** de la lista maestra, no la fecha de elaboración.
7. En el Centro SGC no se muestra “Fecha de elaboración” en estos formatos Word. La cabecera visible es Empresa, Revisión y Fecha de revisión.
8. Editar alcance / requisitos **sincroniza el Word vigente** (no archiva). Archivar + duplicar plantilla solo cuando cambia la revisión, la fecha de revisión, la plantilla o la versión de contenido de la plantilla.
9. **Descargar plantilla PDF no resincroniza el Word.** Si el vigente ya refleja lo guardado (misma revisión, misma fecha de revisión y el mismo cuerpo que `plantillaSync`) y no toca regenerar, se exporta ese `.docx` a PDF una sola vez y se guarda en caché (`backend/sgcPdfDescargaCache.js`). El siguiente clic, con el mismo contenido, devuelve esa caché. Solo se vuelve a sincronizar si hay que regenerar, no hay Word sistema, el Word no refleja los datos o la exportación directa falla.

---

## 2. Modelo mental (tres lugares)

```
┌─────────────────────────────┐   files.copy          ┌──────────────────────────────┐
│  PLANTILLA (externa)        │ ───────────────────►  │  SISTEMA (vigente)           │
│  Solo estructura            │                       │  Carpeta de trabajo          │
│  Placeholders {{…}}         │                       │  Aquí se escriben los datos  │
│  No se modifica por sync    │                       └──────────────┬───────────────┘
└─────────────────────────────┘                                      │ al regenerar
                                                                     ▼
                                                      ┌──────────────────────────────┐
                                                      │  HISTORIAL DE VERSIONES      │
                                                      │  Word renombrado y movido    │
                                                      │  No se borra                 │
                                                      └──────────────────────────────┘
```

- **Plantilla** = fuente de estructura. Si cambias el diseño o un placeholder en Drive, sube `PLANTILLA_CONTENIDO_VERSION` para que el siguiente load archive el sistema viejo y copie de nuevo.
- **Sistema** = el Word que usa el Centro SGC y del que sale el PDF. Siempre se llama igual (`… (sistema).docx`) mientras está vigente.
- **Historial** = copias anteriores. Nombre: `CODIGO Nombre (sistema) - Rev NN - AAAAMMDD.docx`.

### Cuándo archivar y duplicar (versionado del Word)

| Evento | Qué hace el sistema |
| --- | --- |
| Primera vez / no hay Word sistema | Copia la plantilla a la carpeta de trabajo y rellena placeholders |
| Guardar alcance o requisitos (misma rev y misma fecha de lista maestra) | Escribe sobre el Word vigente. **No** mueve nada al historial. **No** sube `No. Rev` |
| Lista maestra cambia revisión o fecha de revisión | Renombra el Word vigente, lo mueve al historial y crea uno nuevo desde la plantilla |
| Cambió el ID de plantilla o `PLANTILLA_CONTENIDO_VERSION` | Igual: archiva el vigente y regenera desde la plantilla nueva |

La revisión oficial **no** se calcula en el formato. La sube Lista Maestra / Solicitud de Documentos (`propagarMetadatosDocumento`). El Word solo la **lee** y la escribe.

### Placeholders

| Placeholder | Origen | Formato escrito |
| --- | --- | --- |
| `{{codigo}}` | Código del formato | `DG-F-02` |
| `{{num_rev}}` | Lista maestra `revision` / `versionVigente` | `00`, `01`, `02`… (2 dígitos) |
| `{{fecha}}` | Lista maestra `fechaRevision` | `DD-MM-AA` (ej. `04-11-26`) |
| `{{texto_alcance}}` | Campo de negocio del formato | Texto plano del alcance |
| Otros de cuerpo | El campo que indiques al pedir el formato | Texto plano (o el reemplazo que definas) |

También se acepta el legado ya relleno (`Código: DG-F-02`, `No. Rev: 00`, `Fecha: 11-07-25`) para no dejar un Word a medias si la plantilla ya no trae llaves.

Prioridad de cabecera:

1. Fila de `sgc_formato_metadatos` del código.
2. Si no hay metadatos, catálogo base de SGC-F-01.
3. Si tampoco, valores por defecto del servicio.

---

## 3. Constantes mínimas en el servicio del formato

En `backend/sgcXxxService.js`:

```js
const CODIGO_FORMATO = 'XX-F-XX';

/** Carpeta del Word vigente. */
const CARPETA_DRIVE_ID = '<ID_CARPETA_TRABAJO>';

/** Carpeta Historial de Versiones. */
const CARPETA_HISTORIAL_DRIVE_ID = '<ID_CARPETA_HISTORIAL>';

/** Plantilla maestra (solo lectura / files.copy). */
const TEMPLATE_DRIVE_ID = '<ID_DEL_LINK_PLANTILLA>';

/**
 * Subir cuando cambien placeholders o la estructura que el sync debe rellenar.
 * Si el dato guardado es menor, el siguiente load archiva y regenera.
 */
const PLANTILLA_CONTENIDO_VERSION = 1;

const NOMBRE_PLANTILLA_SISTEMA = 'XX-F-XX Nombre (sistema).docx';
```

Cómo sacar el ID:

- Doc: `https://docs.google.com/document/d/ESTE_ES_EL_ID/edit`
- Carpeta: `https://drive.google.com/drive/folders/ESTE_ES_EL_ID`

Referencia vigente: `backend/sgcDgF02Service.js`  
(`TEMPLATE_DRIVE_ID`, `CARPETA_DRIVE_ID`, `CARPETA_HISTORIAL_DRIVE_ID`, `resolverCabeceraListaMaestra`, `debeRegenerarDocumentoSistema`, `archivarDocumentoSistemaActual`, `crearDocumentoSistemaDesdePlantilla`, `resyncCompletoDesdePlantilla`).

Copia del archivo: `drive.files.copy` de la plantilla hacia `CARPETA_DRIVE_ID`.  
Archivo viejo: `driveService.renombrarArchivoPorId` + `driveService.moverArchivoDrive` hacia `CARPETA_HISTORIAL_DRIVE_ID`.  
Texto: Docs API `replaceAllText` sobre una copia temporal; el resultado se exporta a docx y se escribe en el archivo sistema (`reemplazarArchivoEnDrive`). La plantilla no se toca.

---

## 4. Flujo obligatorio al cargar / guardar

1. Resolver cabecera con `resolverCabeceraListaMaestra` (código, revisión, fecha de revisión).
2. Resolver el Word de trabajo en la carpeta de trabajo (o el `plantillaSistemaDriveFileId` de BD). Rechazar el ID de la plantilla.
3. Regenerar (`debeRegenerarDocumentoSistema`) si:
   - no hay origen, o el origen no es `TEMPLATE_DRIVE_ID`;
   - `plantillaContenidoVersion` guardada &lt; `PLANTILLA_CONTENIDO_VERSION`;
   - la revisión o la fecha de revisión de la lista maestra cambiaron respecto a `plantillaSync`.
4. Si regenera:
   - renombrar el Word vigente y **moverlo** al historial (no borrarlo);
   - `files.copy` de la plantilla → carpeta de trabajo, con el nombre sistema fijo.
5. Rellenar placeholders (`{{codigo}}`, `{{num_rev}}`, `{{fecha}}` y los de cuerpo) **en la copia**, nunca en la plantilla.
6. Si el guardado es solo de contenido (alcance, requisitos, etc.) y la cabecera no cambió: reemplazar ese texto en el Word vigente. No archivar.
7. Persistir en BD el ID del **sistema**, `plantillaOrigenDriveId`, `plantillaContenidoVersion` y `plantillaSync` (snapshot de lo último escrito, incluida la rev/fecha de lista maestra).

Si el reemplazo de texto no deja el alcance esperado: reintentar un resync completo desde la plantilla (copiar de nuevo y aplicar placeholders). No parchar a ciegas dejando `{{texto_alcance}}` en el PDF.

Al aplicar placeholders, **no filtrar** los requests cuyo texto buscado contiene `{{`. Ese filtro deja el marcador sin reemplazar.

### Descarga PDF (botón «Descargar plantilla PDF»)

El Word ya quedó escrito al guardar o al regenerar. El botón solo lo convierte a PDF.

1. Leer el registro y la cabecera de lista maestra. No listar la carpeta de Drive ni llamar `cargarFormato` otra vez.
2. Si `debeRegenerarDocumentoSistema` es falso, hay `plantillaSistemaDriveFileId` y el Word ya refleja los datos: buscar el PDF en `sgcPdfDescargaCache` (clave = cuerpo + revisión + fecha de revisión + id del Word). Si está, devolverlo.
3. Si no está en caché, exportar el `.docx` vigente a PDF **una vez** (copia temporal a Google Doc, `files.export`, borrar la copia) y guardar esa caché.
4. Resincronizar y luego exportar solo en el camino lento: regeneración, Word ausente, contenido distinto de `plantillaSync`, o fallo de la exportación directa.

La primera descarga después de un cambio de contenido espera la conversión de Google. Las siguientes, con el mismo contenido, no vuelven a tocar el Word. La clave de la caché cambia cuando cambia el texto o la cabecera, así que no se sirve un PDF viejo.

---

## 5. Qué reutilizar del proyecto

| Pieza | Dónde |
| --- | --- |
| Copiar plantilla → carpeta de trabajo | `drive.files.copy` (ver `crearDocumentoSistemaDesdePlantilla`) |
| Renombrar antes de archivar | `driveService.renombrarArchivoPorId` |
| Mover al historial | `driveService.moverArchivoDrive` |
| Reemplazar texto | Docs API `replaceAllText` (`crearReplaceRequest`) |
| Cabecera desde lista maestra | `resolverCabeceraListaMaestra` (metadatos + catálogo F-01) |
| Decidir si archivar | `debeRegenerarDocumentoSistema` |
| Persistencia del formato | `sgcDgF05Service` (`asegurarTablaSgcFormatoDatos`, `persistirRegistroSgc`, `obtenerRegistroSgcPersistido`) |
| UI cabecera | `revisionListaMaestra` / `fechaRevisionListaMaestraDisplay` en el preview |
| Caché del PDF de descarga | `backend/sgcPdfDescargaCache.js` (`leer` / `guardar`) |
| Descarga sin resincronizar | `descargarPlantillaPdf` en `sgcDgF02Service.js` y `sgcDgF03Service.js` |

Patrón a copiar (lógica, no diseño visual): `sgcDgF02Service.js`.

---

## 6. Checklist de implementación (otro formato Word)

- [ ] Crear / ubicar el Google Doc **plantilla** con `Código: {{codigo}}`, `No. Rev: {{num_rev}}`, `Fecha: {{fecha}}` y los placeholders de cuerpo.
- [ ] Anotar carpeta de **trabajo** y carpeta de **historial** (links + IDs).
- [ ] Compartir plantilla (lectura) y ambas carpetas (edición) con la cuenta Drive del backend.
- [ ] Constantes `TEMPLATE_DRIVE_ID`, `CARPETA_DRIVE_ID`, `CARPETA_HISTORIAL_DRIVE_ID`, `PLANTILLA_CONTENIDO_VERSION`.
- [ ] Rechazar la plantilla como archivo de trabajo.
- [ ] Al regenerar: renombrar + mover al historial, luego `files.copy` de la plantilla.
- [ ] Rellenar cabecera solo desde lista maestra. Un guardado de contenido no incrementa `No. Rev`.
- [ ] `{{fecha}}` = fecha de revisión (`DD-MM-AA`).
- [ ] Centro SGC: sin bloque “Fecha de elaboración”; mostrar Revisión y Fecha de revisión.
- [ ] Contenido (alcance, etc.) se escribe en el Word vigente; no se archiva en cada guardado.
- [ ] Subir `PLANTILLA_CONTENIDO_VERSION` si cambian los placeholders, para forzar una regeneración.
- [ ] No borrar Words del historial.
- [ ] Probar: abrir el formato → Word sistema con cabecera de lista maestra y cuerpo relleno (sin `{{…}}` en el PDF).
- [ ] Probar: editar alcance y guardar → el mismo archivo se actualiza; el historial no gana un archivo nuevo; la revisión no sube.
- [ ] Probar: cambiar revisión en lista maestra → el Word anterior aparece en historial con `Rev NN - AAAAMMDD` y el vigente sale de la plantilla.
- [ ] Probar: editar la plantilla en Drive y subir `PLANTILLA_CONTENIDO_VERSION` → el siguiente load trae ese diseño; el historial previo queda intacto.
- [ ] Descargar PDF: si el Word ya está al día, no resincronizar; la segunda descarga del mismo contenido sale de `sgcPdfDescargaCache`.

---

## 7. Prompt corto para pedir ayuda en Cursor (copiar/pegar)

```
Implementa sync plantilla Word → sistema para el formato <CODIGO>,
igual que DG-F-02 (docs/GUIA-PLANTILLA-WORD-SGC.md).
Solo flujo de archivos y placeholders; sin reglas de diseño visual.

PLANTILLA (solo lectura):
<link del Google Doc>
ID: <id>

Carpeta de TRABAJO (Word vigente):
<link de la carpeta>
ID: <id>
Nombre del archivo: <CODIGO Nombre (sistema).docx>

Carpeta HISTORIAL DE VERSIONES:
<link de la carpeta>
ID: <id>

Placeholders de cabecera (obligatorios, desde Lista Maestra):
Código: {{codigo}}    No. Rev: {{num_rev}}    Fecha: {{fecha}}
{{fecha}} = fecha de revisión (DD-MM-AA), no fecha de elaboración.

Placeholders de cuerpo:
- {{texto_…}} ← campo <nombre del campo>

Requisitos:
- TEMPLATE_DRIVE_ID distinto del documento de trabajo
- nunca escribir en la plantilla
- al regenerar: renombrar y mover el Word vigente al historial (no borrar),
  luego files.copy de la plantilla a la carpeta de trabajo
- regenerar solo si cambia plantilla, PLANTILLA_CONTENIDO_VERSION,
  revisión o fecha de revisión de la lista maestra
- un guardado de contenido NO sube la revisión y NO archiva
- Descargar plantilla PDF NO resincroniza el Word si ya refleja lo guardado;
  exporta una vez y cachea con backend/sgcPdfDescargaCache.js.
  La siguiente descarga del mismo contenido sale de esa caché
- cabecera: resolverCabeceraListaMaestra (sgc_formato_metadatos / SGC-F-01)
- UI: sin “Fecha de elaboración”; Revisión y Fecha de revisión desde lista maestra
- patrón: backend/sgcDgF02Service.js
```

---

## 8. Errores típicos a evitar

| Error | Consecuencia |
| --- | --- |
| Usar el mismo Doc como plantilla y como sistema | El diseño maestro se pisa o se pierde el historial |
| Guardar en BD el ID de la plantilla | El editor trabaja sobre el maestro |
| Borrar el Word viejo en lugar de moverlo | No queda historial de versiones |
| Subir `No. Rev` al guardar el alcance | La revisión deja de coincidir con la lista maestra |
| Escribir en `{{fecha}}` la fecha de elaboración | La cabecera del Word no cuadra con Fecha de revisión |
| Mostrar “Fecha de elaboración” en el Centro SGC | La pantalla no coincide con la cabecera del Word |
| Filtrar los `replaceAllText` que contienen `{{` | El PDF se queda con `{{texto_alcance}}` (u otro placeholder) |
| Archivar en cada guardado de contenido | El historial se llena de copias que no son un cambio de revisión |
| No subir `PLANTILLA_CONTENIDO_VERSION` tras cambiar placeholders | El sistema sigue el Word viejo y no adopta la plantilla nueva |
| Regenerar o reescribir archivos que ya están en el historial | Se destruye una versión cerrada |
| Resincronizar el Word en cada «Descargar plantilla PDF» | La descarga tarda todo el sync de Drive aunque el contenido no cambió |

---

## 9. Referencia ya implementada

### DG-F-02 · Alcance

| Rol | Link / valor |
| --- | --- |
| Plantilla | `https://docs.google.com/document/d/1wUZcyt1LzEzlQo_5mMSINaNkjjs4AhOk/edit` |
| ID plantilla | `1wUZcyt1LzEzlQo_5mMSINaNkjjs4AhOk` |
| Carpeta de trabajo | `https://drive.google.com/drive/folders/1xU8fO32D2eF-fwKRzRgAQKN7oo59dvLO` |
| Carpeta historial | `https://drive.google.com/drive/folders/1-G8mPoNXykGaH4cFfg9J-RH6ACz_Z8G4` |
| Nombre vigente | `DG-F-02 Alcance (sistema).docx` |
| Nombre archivado | `DG-F-02 Alcance (sistema) - Rev NN - AAAAMMDD.docx` |
| Cabecera | `{{codigo}}` `{{num_rev}}` `{{fecha}}` ← lista maestra |
| Cuerpo | `{{texto_alcance}}` |
| Código | `backend/sgcDgF02Service.js` |
| UI | Centro SGC: Empresa, Revisión, Fecha de revisión. Sin fecha de elaboración |

### SGC-PO-01 · Política de calidad

| Rol | Link / valor |
| --- | --- |
| Plantilla | `https://docs.google.com/document/d/1xzgZ9xcm414a-wV5iy_iF8fT-lMNCUxT/edit` |
| ID plantilla | `1xzgZ9xcm414a-wV5iy_iF8fT-lMNCUxT` |
| Carpeta de trabajo | `https://drive.google.com/drive/folders/1qA9FXEv3Cqpexps1Zx_E6WrQJwDhRNpw` |
| Carpeta historial | `https://drive.google.com/drive/folders/1YtwfRsNyZa8ToctuUADeWpYe62cj3PVr` |
| Nombre vigente | `SGC-PO-01 Politica de calidad (sistema).docx` |
| Nombre archivado | `SGC-PO-01 Politica de calidad (sistema) - Rev NN - AAAAMMDD.docx` |
| Cabecera (pie) | `{{codigo}}` `{{num_rev}}` `{{fecha}}` ← lista maestra |
| Cuerpo | `{{politica_calidad}}` |
| Código | `backend/sgcPo01Service.js` |
| UI | Centro SGC: Empresa, Revisión, Fecha de revisión. Sin fecha de elaboración |

---

## 10. Borrador local (UI)

Misma regla que la guía Excel, sección 10 de `docs/GUIA-PLANTILLA-EXCEL-SGC.md`:

- En el `next` de cada `persistir*` llamar `limpiarBorradorLocalSgc()`.
- En el `error`, `persistirBorradorLocalSgcAhora()`.
- No reescribir el borrador al salir si no hay cambios pendientes.

Referencia de preview: `persistirDgF05()` / `persistirSgcF18()` en `sgc-plantilla-preview.component.ts`. El flujo Word de DG-F-02 usa el mismo contrato de borrador del preview.
