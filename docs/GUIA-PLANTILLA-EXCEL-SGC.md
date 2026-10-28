# Guía: plantilla Excel externa → archivo dinámico del sistema (SGC)

Checklist para implementar en **otro formato** la misma idea que DG-F-05 (referencia vigente):  
diseño en un Google Sheet **plantilla** (aparte) y trabajo/historial en un Google Sheet **sistema** (dinámico).

No cubre reglas de diseño (bordes, colores, anchos, merges visuales). Solo el flujo de archivos y sync.

Si el formato tiene **archivero**, el nombre de cada hoja no es `CODIGO-MMAA`: ver **§2.1** (folio o valor de un campo del formulario; lo defines tú al solicitar el formato).

---

## 1. Datos que debes proporcionar (rellenar antes de codear)

### A) Archivo dinámico del sistema (Excel de trabajo)

| Campo | Valor |
| --- | --- |
| Nombre / código del formato | _ej. DG-F-XX / SGC-F-XX_ |
| Link del Google Sheet **sistema** | |
| ID de Drive (entre `/d/` y `/edit`) | |
| Carpeta Drive destino (si aplica) | |
| Nombre deseado del archivo en Drive | |
| Convención de pestañas de historial | _ej. `DGF05-MMAA` → adapta al código_ **(solo si NO hay archivero; ver §2.1)** |
| Versionado dentro del mismo mes | _1ª = `CODIGO-MMAA`; 2ª = `CODIGO-MMAA_2`; 3ª = `_3`…_ **(solo si NO hay archivero)** |
| Pestaña de trabajo vigente | _siempre la última versión del mes; no reescribir meses previos_ |
| ¿Tiene archivero? | _Sí / No_ |
| Si tiene archivero → nombre de hoja | _`folio` **o** valor de un campo del formulario (indicar cuál)_ |

Ejemplo de link sistema:

`https://docs.google.com/spreadsheets/d/________________________/edit`

### B) Archivo plantilla (Excel externo, solo diseño/estructura)

| Campo | Valor |
| --- | --- |
| Link del Google Sheet **plantilla** | |
| ID de Drive | |
| Nombre de la pestaña a copiar | _casi siempre `Plantilla`_ |
| ¿La plantilla se edita a mano en Drive? | Sí — el sistema **solo la lee y la copia** |

Ejemplo de link plantilla:

`https://docs.google.com/spreadsheets/d/________________________/edit`

### C) Reglas fijas (no negociar)

1. **Nunca** escribir datos de negocio ni borrar hojas dentro del archivo plantilla.
2. **Nunca** usar el ID de la plantilla como `drive_file_id` de trabajo en BD.
3. El historial (pestañas de meses anteriores y versiones `_N` previas) **no se regenera** al cambiar la plantilla; solo la hoja **vigente del mes actual**.
4. La cuenta de servicio / OAuth del backend debe tener acceso de lectura a la plantilla y de edición al sistema.
5. **No** crear pestañas `Alias_r00` / `Partes_r00` (historial de “formato”).
6. Sin archivero: solo pestañas `CODIGO-MMAA` / `CODIGO-MMAA_N`. **Con archivero:** una pestaña por ítem (§2.1); no mezclar con el scheme mensual.

---

## 2. Modelo mental (dos archivos)

```
┌─────────────────────────────┐         copyTo (hoja)          ┌──────────────────────────────┐
│  PLANTILLA (externa)        │  ───────────────────────────►  │  SISTEMA (dinámico)          │
│  Solo estructura / diseño   │                                │  Versiones del mes + hist.   │
│  No se modifica por sync    │                                │  Aquí se escriben los datos  │
└─────────────────────────────┘                                └──────────────────────────────┘
```

- **Plantilla** = fuente de estructura. Si cambias el Excel plantilla en Drive, el siguiente “adoptar / regenerar mes” trae esa estructura.
- **Sistema** = archivo que abre el Centro SGC / editor integrado. Guarda historial por pestañas.

### Versionado dentro del mismo mes (obligatorio en formatos nuevos)

Cada **modificación guardada** del mes genera una pestaña nueva (no sobrescribe la anterior):

| Guardado | Nombre de pestaña (ej. octubre 2026, código DG-F-05) |
| --- | --- |
| 1ª | `DGF05-1026` |
| 2ª | `DGF05-1026_2` |
| 3ª | `DGF05-1026_3` |
| … | `DGF05-1026_N` |

Reglas:

- Base del mes = `CODIGO-MMAA` (vía `nombreHojaHistorialInformacion`; ej. `DGF05` + `1026`).
- Si esa pestaña ya existe → crear la siguiente libre: `_2`, `_3`, … (`driveService.resolverNombreHojaUnico`).
- El editor / sync / PDF abren **siempre la última** versión del mes (`…_N` más alto; sin sufijo = versión 1).
- Meses anteriores (`DGF05-0826`, etc.) **no se tocan**.
- En `aplicarHistorialEnDrive`: `soloHistorialInformacion: true` + `versionarCadaCambioMes: true` (ver `sgcDgF05Service.js`).

### 2.1 Formatos con archivero — nombre de hoja distinto

Cuando el formato tiene **archivero** (lista de ítems: notificaciones, análisis AMEF, etc.), **no** aplica el scheme `CODIGO-MMAA` / `CODIGO-MMAA_N`.

Regla:

| Tipo de formato | Nombre de cada pestaña en el Excel sistema |
| --- | --- |
| Sin archivero (historial por mes) | `CODIGO-MMAA`, luego `_2`, `_3`… |
| **Con archivero** | **Una pestaña por ítem del archivero**; el nombre lo define el solicitante |

Al pedir implementación de un formato con archivero, **tú indicas** cuál de estas dos opciones usar:

1. **Folio del archivero** — la hoja se llama igual que el folio del ítem  
   (ej. SGC-F-12: `CAM-241026-01`).
2. **Valor de un campo del formulario** — la hoja se llama como ese campo (sanitizado para Excel)  
   (ej. SGC-F-11: nombre = campo **proceso**).

Comportamiento común (ambas opciones):

- Cada ítem del archivero → su propia hoja (`copyTo` desde la plantilla externa).
- Al crear / renombrar: sanitizar el título (caracteres inválidos de Excel, longitud) y resolver colisiones (`resolverNombreHojaUnico` o equivalente).
- No versionar por mes (`versionarCadaCambioMes` no aplica).
- El archivo sistema conserva histograma / hojas auxiliares; no se escribe en la plantilla ni se reemplaza el libro entero.
- Si el folio o el valor del campo cambia, renombrar la hoja (si existe) para que siga coincidiendo.

Referencias:

| Formato | Criterio de nombre de hoja |
| --- | --- |
| SGC-F-04 · Reporte de no conformidad | Folio (`NC-…`) |
| SGC-F-12 · Notificación de cambios | Folio (`CAM-…`) |
| SGC-F-22 · Daño o pérdida de propiedad | Folio (`DP-…`) |
| SGC-F-11 · AMEF | Campo del formulario: **proceso** |
| SGC-F-16 · Minuta | Campo del formulario: **Asunto** |
| SGC-F-20 · Ficha de conocimientos | Campo del formulario: **Tipo de fuente** |
| ATH-F-02 · Descripción y perfil de puesto | Campo del formulario: **Puesto** |
| SGC-F-27 · Verificación de equipos de medición | Campo del formulario: **Instrumento de medición** |
| SGC-F-28 · Comparativa de proveedores | Campo del formulario: **Nombre de cotización** |
| SP-F-02 · Reporte de visita y recorrido | Folio (`SPF02-MMAA`) |
| SP-F-07 · Plan del curso | Folio (`PC-…`) |

En la tabla de §1.A (campos «¿Tiene archivero?» y «Si tiene archivero → nombre de hoja») deja escrito, antes de codear, si quieres **folio** o **qué campo** del formulario.

---

## 3. Constantes mínimas en el servicio del formato

En `backend/sgcXxxService.js` (o el servicio del formato):

```js
const CODIGO_FORMATO = 'XX-F-XX'; // código real

/** Plantilla maestra (solo lectura / copyTo). */
const TEMPLATE_DRIVE_ID = '<ID_DEL_LINK_PLANTILLA>';
const TEMPLATE_SHEET_TITLE = 'Plantilla';

/** Archivo de trabajo Centro SGC (historial). */
const DRIVE_FILE_ID_SISTEMA = '<ID_DEL_LINK_SISTEMA>';
const CARPETA_DRIVE_ID = '<ID_CARPETA>'; // si el formato crea/busca archivo en carpeta
const NOMBRE_ARCHIVO_DRIVE = '<Nombre visible en Drive>';
```

Cómo sacar el ID del link:

`https://docs.google.com/spreadsheets/d/ESTE_ES_EL_ID/edit?...`

Referencia de implementación vigente: `backend/sgcDgF05Service.js`  
(`TEMPLATE_DRIVE_ID`, `DRIVE_FILE_ID_SISTEMA`, `adoptarPlantillaEnSistema`, `reescribirHojaDesdePlantilla`, `versionarCadaCambioMes`).

API de copia entre spreadsheets: `driveService.copiarHojaEntreSpreadsheets(sourceId, sourceSheetTitle, destId, newTitle)`.

---

## 4. Flujo obligatorio al guardar / regenerar

1. Resolver el spreadsheet de trabajo = **siempre** `DRIVE_FILE_ID_SISTEMA` (o el guardado en BD si apunta a ese archivo sistema, nunca a la plantilla).
2. Nombre base del mes = `CODIGO-MMAA` (`sgcExcelHistorialService.nombreHojaHistorialInformacion`).
3. Al guardar con cambios reales:
   - Crear **nueva** pestaña del mes (`CODIGO-MMAA` o `CODIGO-MMAA_N` si ya existía).
   - No reutilizar/sobrescribir la versión anterior del mismo mes.
   - No crear pestañas `Alias_rNN`.
4. Si hay que regenerar estructura (falta hoja del mes, o la vigente está rota):
   - Copiar `TEMPLATE_SHEET_TITLE` desde `TEMPLATE_DRIVE_ID` → sistema  
     (idealmente a `_tmp_...`, escribir datos, luego renombrar / reemplazar **solo** la pestaña vigente del mes).
   - **No** borrar pestañas de meses anteriores ni versiones `_N` previas del mes (salvo la que se está reemplazando a propósito).
5. Escribir los datos del formato (BD / payload) **solo** en la pestaña vigente (última del mes).
6. Persistir en BD: `drive_file_id` = ID del **sistema**, más `datos_json`, fechas, etc. (mismo patrón `sgcDgF05Service` / tabla SGC que uses).

Si el sync de celdas falla por estructura rota: **reintentar regenerando desde plantilla** la hoja vigente del mes, no parchear a ciegas una pestaña vieja.

---

## 5. Qué reutilizar del proyecto

| Pieza | Dónde |
| --- | --- |
| Copiar hoja plantilla → sistema | `driveService.copiarHojaEntreSpreadsheets` |
| Listar / renombrar / eliminar / insertar filas | `driveService.*GoogleSheet` |
| Nombre hoja historial MMAA | `sgcExcelHistorialService.nombreHojaHistorialInformacion` |
| Versionar cada guardado del mes (`_2`, `_3`…) | `aplicarHistorialEnDrive({ soloHistorialInformacion: true, versionarCadaCambioMes: true })` |
| Nombre único de pestaña | `driveService.resolverNombreHojaUnico` |
| Persistencia JSON del formato | `sgcDgF05Service` (`asegurarTablaSgcFormatoDatos`, `persistirRegistroSgc`, …) |
| Editor embebido (gid de la hoja vigente) | URL con `gid` de la **última** versión del mes |

Patrón a copiar (lógica, no diseño): `sgcDgF05Service.js` —  
`adoptarPlantillaEnSistema` + `reescribirHojaDesdePlantilla` + historial con `versionarCadaCambioMes` + sync solo sobre la hoja vigente del mes.

---

## 6. Checklist de implementación (otro formato)

- [ ] Crear / ubicar Google Sheet **plantilla** y anotar link + ID + nombre de pestaña.
- [ ] Crear / ubicar Google Sheet **sistema** y anotar link + ID.
- [ ] Compartir ambos con la cuenta Drive del backend.
- [ ] Definir `CODIGO_FORMATO` y convención de pestañas:
  - Sin archivero → `CODIGO-MMAA` / `CODIGO-MMAA_N`.
  - Con archivero → nombre = **folio** o **campo del formulario** (indicado en §1.A; ver §2.1).
- [ ] Constantes `TEMPLATE_*` y `DRIVE_FILE_ID_SISTEMA` en el servicio.
- [ ] `resolverDriveFileId`: priorizar sistema; rechazar plantilla como archivo de trabajo.
- [ ] Sin archivero — historial: `soloHistorialInformacion: true` + `versionarCadaCambioMes: true` (sin `Alias_rNN`).
- [ ] Con archivero — una hoja por ítem (`copyTo` plantilla); no usar `CODIGO-MMAA` ni `versionarCadaCambioMes`.
- [ ] Al cargar: si falta hoja (mes o ítem) → copiar plantilla; editor abre la hoja correcta (última `_N` del mes **o** la del ítem activo).
- [ ] Al guardar (sin archivero): nueva versión del mes (`_2`, `_3`…); si estructura mala → regenerar solo la vigente.
- [ ] Al guardar (con archivero): escribir en la hoja del ítem; renombrar si cambió folio/campo usado como título.
- [ ] Historial: no regenerar meses anteriores ni versiones previas del mes (ni hojas de otros ítems del archivero).
- [ ] Endpoint / UI con `editorUrl` del **sistema** (gid de la hoja vigente / del ítem).
- [ ] Borrador local UI: en el `next` de `persistir*` llamar `limpiarBorradorLocalSgc()`; en `error`, `persistirBorradorLocalSgcAhora()` (ver §10).
- [ ] Probar sin archivero: 3 guardados en el mismo mes → `CODIGO-MMAA`, `_2`, `_3`; meses viejos intactos.
- [ ] Probar con archivero: 2 ítems → 2 pestañas con el nombre acordado (folio o campo); crear/renombrar/borrar coherente.
- [ ] Probar: editar plantilla → regenerar vigente → se refleja; historial previo intacto.
- [ ] Probar UI: Guardar → desaparece «Cambios sin guardar»; salir y volver → **no** sale «Borrador local encontrado».

---

## 7. Prompt corto para pedir ayuda en Cursor (copiar/pegar)

```
Implementa sync plantilla→sistema para el formato <CODIGO>, igual que DG-F-05
(solo flujo de archivos; sin reglas de diseño visual).

Archivo SISTEMA (dinámico):
<link completo del Google Sheet>

Archivo PLANTILLA (externa):
<link completo del Google Sheet>
Pestaña a copiar: Plantilla

Requisitos:
- TEMPLATE_DRIVE_ID vs DRIVE_FILE_ID_SISTEMA separados
- copyTo de la hoja Plantilla al sistema
- ¿Archivero? Sí / No
  - Si NO: cada guardado del mes crea CODIGO-MMAA, luego CODIGO-MMAA_2, _3… (versionarCadaCambioMes)
  - Si SÍ: una pestaña por ítem; nombre de hoja = folio del archivero
    OR valor del campo <NOMBRE_CAMPO> del formulario (elige uno; ver §2.1)
- nunca pestañas Alias_rNN / Partes_r00
- nunca escribir en la plantilla ni borrar historial / hojas de otros ítems
- sin archivero: datos solo en la última versión del mes
- con archivero: datos solo en la hoja del ítem activo
- reutilizar driveService.copiarHojaEntreSpreadsheets
  - sin archivero: patrón sgcDgF05Service (versionarCadaCambioMes)
  - con archivero: patrón sgcSgcF12Service (folio) o sgcSgcF11Service (campo)
- UI: limpiarBorradorLocalSgc() al guardar OK; no reescribir borrador al salir si no hay cambios
```

---

## 8. Errores típicos a evitar

| Error | Consecuencia |
| --- | --- |
| Usar un solo Excel para plantilla y sistema | Se pierde historial o se pisa el diseño |
| Guardar en BD el ID de la plantilla | El editor “trabaja” sobre el maestro |
| Regenerar la pestaña de un mes pasado o una `_N` vieja | Se destruye el historial visual |
| Reutilizar/sobrescribir la misma pestaña del mes en cada guardado | Se pierde el historial intra-mes |
| Usar `CODIGO-MMAA` en un formato con archivero | Mezcla historial mensual con ítems; hojas ilegibles / chocan |
| No definir si el archivero nombra por folio o por campo | Implementación a ciegas; hay que acordarlo en §1.A antes de codear |
| Crear pestañas `Alias_r00` / `Partes_r00` | Historial de formato confuso; no usar |
| Escribir celdas sin copiar plantilla cuando faltan filas/columnas | Rangos inválidos / layout roto |
| `copyTo` a nombre que ya existe sin versionar (`_2`, `_3`) | Choque de pestañas o hoja a medias |
| Olvidar `limpiarBorradorLocalSgc()` tras guardar OK | Queda «Cambios sin guardar» y al reentrar «Borrador local encontrado» |
| Respaldo local al salir aunque no haya cambios | Se recrea el borrador fantasma tras un guardado limpio |

---

## 9. Referencias ya implementadas

### DG-F-05 · Listado de partes interesadas (**patrón a seguir**)

| Rol | Link |
| --- | --- |
| Plantilla | `https://docs.google.com/spreadsheets/d/1-B7XvU4BBFc98JOKaSY6zVAMCV03g6lCC7WBKtuiif0/edit` |
| Sistema | `https://docs.google.com/spreadsheets/d/1n4NOREoSxd5-kn1jI245m0m9hKL4fntH5BvTMUg6NDg/edit` |
| Pestaña plantilla | `Plantilla` |
| Historial | `DGF05-MMAA`, `DGF05-MMAA_2`, `_3`… (`versionarCadaCambioMes`) |
| Código | `backend/sgcDgF05Service.js` |

### SP-F-02 · Reporte de visita y recorrido

| Rol | Link |
| --- | --- |
| Plantilla | `https://docs.google.com/spreadsheets/d/1X_MSGiMu9Bksi3ip9pOm3tMtMZzUXwvo86wGiGvmHQc/edit` |
| Sistema | `https://docs.google.com/spreadsheets/d/1lZOjlr7PAvoudcOJF5Qz28x3ok88UUEb32L1YnxUAZI/edit` |
| Pestaña plantilla | `Levantamiento eléctrico` |
| Trabajo | Archivero SGC: una pestaña por reporte; **nombre = folio `SPF02-MMAA`** (§2.1 opción 1); `copyTo` desde plantilla |
| Código | `backend/sgcSpF02Service.js` + `backend/pcRecorridoService.js` |
| Nota | **SGC y PC comparten la misma plantilla externa.** SGC escribe solo en el archivo sistema (conserva histograma). PC crea un Google Sheet dedicado por PIPC (`copiarGoogleSheetACarpeta` desde la plantilla) y renombra la hoja al folio; nunca usa ni borra la plantilla ni el sistema SGC |

### SP-F-04 · Control de Proyectos Biznaga

| Rol | Link |
| --- | --- |
| Plantilla | `https://docs.google.com/spreadsheets/d/1y87zEHPmEboXR7y5GAjpPbJPb3Ps0sm62cknZACMhOs/edit` |
| Sistema | `https://docs.google.com/spreadsheets/d/1efmyxhAYxuN-H0BxGpUlSsYb3uhutWKDYBTHh8SfnMo/edit` |
| Pestaña plantilla | `Plantilla` |
| Historial | `SPF04-MMAA`, `SPF04-MMAA_2`, `_3`… (cada sync con cambios reales; sin archivero) |
| Código | `backend/sgcSpF04Service.js` |
| Nota | Vista generada desde Control de Proyectos + ATH-F-09. El archivo sistema conserva histograma; no se escribe en la plantilla |

### SP-F-07 · Plan del curso

| Rol | Link |
| --- | --- |
| Plantilla | `https://docs.google.com/spreadsheets/d/1Pj1ZlJDqGNUCr36CktlcWDn_SRDy7vZpXi3ltCCN0GU/edit` |
| Sistema | `https://docs.google.com/spreadsheets/d/1p0XiIIwWth04aKYTs6XYldsy4yNvHGdbJWfWEfYVs4w/edit` |
| Pestaña plantilla | `Plantilla` |
| Trabajo | Archivero: una pestaña por plan; **nombre = folio `PC-…`** (§2.1 opción 1); `copyTo` desde plantilla |
| Código | `backend/sgcSpF07Service.js` |
| Nota | El archivo sistema conserva histograma; no se escribe en la plantilla ni se reemplaza el libro entero |

### DG-F-04 · Análisis FODA (referencia anterior)

| Rol | Link |
| --- | --- |
| Plantilla | `https://docs.google.com/spreadsheets/d/1WKgNlkGR481eOhwl_wv4l5HaVj8pt3FR4oF4I_1GTuc/edit` |
| Sistema | `https://docs.google.com/spreadsheets/d/1VfHOIJEeCJ8QZNYdWp6spszmcFKq_ZNVDn24oX8Rj9I/edit` |
| Código | `backend/sgcDgF04Service.js` |
| Nota | Preferir el patrón de versionado de DG-F-05 en formatos nuevos |

### ATH-F-02 · Descripción y perfil de puesto

| Rol | Link |
| --- | --- |
| Plantilla | `https://docs.google.com/spreadsheets/d/1bl97eZoBhPSe50jpkD7rjTZPiA9XqKLSFQKNNB86R6M/edit` |
| Sistema | `https://docs.google.com/spreadsheets/d/1PH6_usxtmpYsr8AOYqlGi9Z9fJEZ4hywDEqKDjIfKOk/edit` |
| Pestaña plantilla | `Plantilla` |
| Trabajo | Archivero: una pestaña por perfil; **nombre = campo `Puesto`** (§2.1 opción 2); `copyTo` desde plantilla |
| Código | `backend/sgcAthF02Service.js` |
| Nota | El archivo sistema conserva histograma y hojas auxiliares; no se escribe en la plantilla ni se reemplaza el libro entero |

### ATH-F-06 · Detección de necesidades de capacitación (DNC)

| Rol | Link |
| --- | --- |
| Plantilla | `https://docs.google.com/spreadsheets/d/1fdsvuQkiZ0Wg-un23-EKjDYOnmles4HCvCR-_f-YxJs/edit` |
| Sistema | `https://docs.google.com/spreadsheets/d/1ozFzD61H4fiskcLExEPF0TiNoLQqEfmtqsfkGPL4lxc/edit` |
| Pestaña plantilla | `Plantilla` |
| Historial | `ATHF06-MMAA`, `ATHF06-MMAA_2`, `_3`… (`versionarCadaCambioMes`) |
| Código | `backend/sgcAthF06Service.js` |
| Nota | El archivo sistema conserva histograma; no se escribe en la plantilla |

### ATH-F-14 · Control de vacaciones

| Rol | Link |
| --- | --- |
| Plantilla | `https://docs.google.com/spreadsheets/d/1nKn62UggYGS16Wx_sl0t8ZfunixTdixrsW43L7aDWwk/edit` |
| Sistema | `https://docs.google.com/spreadsheets/d/1Fxn1FNWcByT3RcinuVmmf4IgPR4g1AVksYF149-YvBc/edit` |
| Pestaña plantilla | `Plantilla` |
| Historial | `ATHF14-MMAA`, `ATHF14-MMAA_2`, `_3`… (`versionarCadaCambioMes`) |
| Código | `backend/sgcAthF14Service.js` |
| Nota | Sin archivero. El archivo sistema conserva histograma; no se escribe en la plantilla |

### ATH-F-08 · Eficacia de la capacitación

| Rol | Link |
| --- | --- |
| Plantilla | `https://docs.google.com/spreadsheets/d/1t-N6A6kZzcFzy3bg5X6TqZyP6G95n0Ic-386N7XaKd4/edit` |
| Sistema | `https://docs.google.com/spreadsheets/d/1-tq5eEeFmUPk8cJXOmPEXpycthXTXwe6kwK_-M-7kww/edit` |
| Pestaña plantilla | `Plantilla` |
| Historial | `ATHF08-MMAA`, `ATHF08-MMAA_2`, `_3`… (`versionarCadaCambioMes`) |
| Código | `backend/sgcAthF08Service.js` |
| Nota | El archivo sistema conserva histograma y pestañas previas (`ATHF08-0926`…, legado `Evaluación`); no se escribe en la plantilla |

### SGC-F-03 · Lista de distribución de documentos

| Rol | Link |
| --- | --- |
| Plantilla | `https://docs.google.com/spreadsheets/d/1DWdTrHeYbSlXp2lHIqrUzHcxxB4Oo9_8LxjiM-juMH4/edit` |
| Sistema | `https://docs.google.com/spreadsheets/d/1XpcTc_ZzNMf747KGejC3D4NM67hwHTIpPJ3--mRKtsA/edit` |
| Pestaña plantilla | `Plantilla` |
| Historial | `SGCF03-MMAA`, `SGCF03-MMAA_2`, `_3`… (`versionarCadaCambioMes`) |
| Código | `backend/sgcF03Service.js` |
| Nota | El archivo sistema conserva histograma; no se escribe en la plantilla |

### SGC-F-04 · Reporte de no conformidad

| Rol | Link |
| --- | --- |
| Plantilla | `https://docs.google.com/spreadsheets/d/17E4xiCV-APDAMxbCankh-YY1LU8WuK67yhodlSpqNcU/edit` |
| Sistema | `https://docs.google.com/spreadsheets/d/1bVfQsZxrpkLg199i_bJ0XhBDTY-_099KVMg1IWyqAHY/edit` |
| Pestaña plantilla | `Plantilla` (legado aceptado: `Reporte`) |
| Trabajo | Archivero: una pestaña por reporte; **nombre = folio `NC-…`** (§2.1 opción 1); `copyTo` desde plantilla |
| Código | `backend/sgcSgcF04Service.js` |
| Nota | El archivo sistema conserva histograma; no se escribe en la plantilla ni se reemplaza el libro entero |

### SGC-F-06 · Lista y calificación de auditores internos

| Rol | Link |
| --- | --- |
| Plantilla | `https://docs.google.com/spreadsheets/d/1CsIGwpxURUGwwgd16YGacJK0pPkoYmcsdMoGaY7B-pk/edit` |
| Sistema | `https://docs.google.com/spreadsheets/d/172FXnaaY-62DluYGLjZRogqZF3ZZ_aFwCf4Ww-31T2A/edit` |
| Pestaña plantilla | `Plantilla` |
| Historial | `SGCF06-MMAA`, `SGCF06-MMAA_2`, `_3`… (`versionarCadaCambioMes`) |
| Código | `backend/sgcSgcF06Service.js` |
| Nota | Archivero de listas en BD/UI; Excel proyecta la lista activa en pestañas mensuales. El archivo sistema conserva histograma; no se escribe en la plantilla |

### SGC-F-07 · Programa de auditoría

| Rol | Link |
| --- | --- |
| Plantilla | `https://docs.google.com/spreadsheets/d/112kGODk9XU0lvJ0LmYkgVTSOKdTL1-3e3l2jNuJQ2wE/edit` |
| Sistema | `https://docs.google.com/spreadsheets/d/1wvrP_EB5XvdL5xu_j5xiiX53o8Bz9KzvLaVMCwwXT2w/edit` |
| Pestaña plantilla | `Plantilla` |
| Historial | `SGCF07-MMAA`, `SGCF07-MMAA_2`, `_3`… (`versionarCadaCambioMes`) |
| Código | `backend/sgcF07Service.js` |
| PDFs firmados | `https://drive.google.com/drive/folders/1yodruqEhzAHJbQY3cU-ZvQFTLKKsT4gp` (Documentos Firmados) |
| Nota | Archivero de programas en BD/UI; Excel proyecta el programa activo en pestañas mensuales. «Motivo de Auditoría» es campo del formulario (no nombra la hoja). El archivo sistema conserva histograma; no se escribe en la plantilla |

### SGC-F-08 · Plan de auditoría

| Rol | Link |
| --- | --- |
| Plantilla | `https://docs.google.com/spreadsheets/d/1EJMKbuUde5EVdtf39-nAppB_9NBwmTwjKbYjE1HbqJ8/edit` |
| Sistema | `https://docs.google.com/spreadsheets/d/19R5biJd2EHKN6OURoSEpvLnDWQSDi8YjfL9PhVdla-0/edit` |
| Pestaña plantilla | `Plantilla` |
| Historial | `SGCF08-MMAA`, `SGCF08-MMAA_2`, `_3`… (`versionarCadaCambioMes`); sin archivero |
| Código | `backend/sgcF08Service.js` |
| Nota | El archivo sistema conserva histograma; no se escribe en la plantilla ni se reemplaza el libro entero |

### SGC-F-17 · Bitácora de calibración y verificación de equipos de medición

| Rol | Link |
| --- | --- |
| Plantilla | `https://docs.google.com/spreadsheets/d/1cVw6AeNlQLrl8iwb0pdUADMb61oI2hDgZGVo-lB9Yao/edit` |
| Sistema | `https://docs.google.com/spreadsheets/d/1XzxX2gRHUSf0z2ToPp1YCvzD6IOzzRUlpsEsY62takk/edit` |
| Pestaña plantilla | `Plantilla` (legado aceptado: `Plantilla.`) |
| Historial | `SGCF17-MMAA`, `SGCF17-MMAA_2`, `_3`… (cada guardado con cambios; sin archivero) |
| Código | `backend/sgcF17Service.js` |
| Nota | El archivo sistema conserva histograma y hojas legadas `MMAA-NN`; no se escribe en la plantilla |

### SGC-F-18 · Tabla de requisitos legales y reglamentarios

| Rol | Link |
| --- | --- |
| Plantilla | `https://docs.google.com/spreadsheets/d/1KuD6RwHRedvqsot39ulw5Gps5uUKbK6OzvVlWyELDpU/edit` |
| Sistema | `https://docs.google.com/spreadsheets/d/1Ge8QOuUhgrnpEWBH4oTXi4orwDuLsXZKz-ApaLWErSk/edit` |
| Pestaña plantilla | `Plantilla` |
| Historial | `SGCF18-MMAA`, `SGCF18-MMAA_2`, `_3`… (`versionarCadaCambioMes`) |
| Código | `backend/sgcSgcF18Service.js` |

### SGC-F-19 · Listado de conocimientos de la organización

| Rol | Link |
| --- | --- |
| Plantilla | `https://docs.google.com/spreadsheets/d/1KUJxWvly0Hm0urH0aAGoaEWZfmBloahpAXA7uwQfAFg/edit` |
| Sistema | `https://docs.google.com/spreadsheets/d/1ExqXpnX4J617v1V2JimjEzg1VN_sV0XJOHQnaCxTLMA/edit` |
| Pestaña plantilla | `Plantilla` |
| Historial | `SGCF19-MMAA`, `SGCF19-MMAA_2`, `_3`… (`versionarCadaCambioMes`) |
| Código | `backend/sgcF19Service.js` |
| Nota | El archivo sistema conserva histograma y hoja legada `Copia de Listado de conocimientos`; no se escribe en la plantilla |

### SGC-F-20 · Ficha de conocimientos

| Rol | Link |
| --- | --- |
| Plantilla | `https://docs.google.com/spreadsheets/d/1IFE1KVStlqrHs5UIzhunjWh-tGoNfXtV1caVskE4unc/edit` |
| Sistema | `https://docs.google.com/spreadsheets/d/1we0bWgQpKUKybvveOrqmmrWdtfwFFIdbFMjWQs1Oxm4/edit` |
| Pestaña plantilla | `Plantilla` |
| Trabajo | Archivero: una pestaña por ficha; **nombre = campo `Tipo de fuente`** (§2.1 opción 2); `copyTo` desde plantilla |
| Código | `backend/sgcF20Service.js` |
| Nota | El archivo sistema conserva histograma y `Hoja2` (catálogo); no se escribe en la plantilla |

### SGC-F-11 · AMEF

| Rol | Link |
| --- | --- |
| Plantilla | `https://docs.google.com/spreadsheets/d/1mR9vTvMRJ_E0-416ujaCkDqg1hwPKpujZN0OQ8AseZE/edit` |
| Sistema | `https://docs.google.com/spreadsheets/d/15iP8UalTLSW83DDuEmQEPZaAG3zao06zO51guKiR9_k/edit` |
| Pestaña plantilla | `Plantilla` |
| Trabajo | Archivero: una pestaña por análisis; **nombre = campo `proceso`** (§2.1 opción 2); `copyTo` desde plantilla |
| Código | `backend/sgcSgcF11Service.js` |
| Nota | El archivo sistema conserva histograma/guías; no se escribe en la plantilla |

### SGC-F-12 · Notificación de cambios al SGC

| Rol | Link |
| --- | --- |
| Plantilla | `https://docs.google.com/spreadsheets/d/1TyIqkHtAZGy405u7lNCq-j1LzW-dMxRjWG4LzMwonJg/edit` |
| Sistema | `https://docs.google.com/spreadsheets/d/1Disbn6atnNc6L56D6axW0Y4hCSqspK2SfStbujGQf78/edit` |
| Pestaña plantilla | `Plantilla` |
| Trabajo | Archivero: una pestaña por notificación; **nombre = folio `CAM-…`** (§2.1 opción 1); `copyTo` desde plantilla |
| Código | `backend/sgcSgcF12Service.js` |
| Nota | Igual que SGC-F-11: el archivo sistema conserva histograma; no se escribe en la plantilla ni se reemplaza el libro entero |

### SGC-F-16 · Minuta

| Rol | Link |
| --- | --- |
| Plantilla | `https://docs.google.com/spreadsheets/d/18aG752wFV2Pt7EE0TT_DD4jM5ldGDo6MKD889woKgzE/edit` |
| Sistema | `https://docs.google.com/spreadsheets/d/1Rc-mprKV22mONhk81zHjPTChaEgF0HBiUESRx8D_y-M/edit` |
| Pestaña plantilla | `Plantilla` |
| Trabajo | Archivero: una pestaña por minuta; **nombre = campo `Asunto`** (§2.1 opción 2); `copyTo` desde plantilla |
| Código | `backend/sgcF16Service.js` |
| Nota | El archivo sistema conserva histograma y hojas legado `SGCF16-MMAA`; no se escribe en la plantilla ni se reemplaza el libro entero |

### SGC-F-22 · Reporte de daño o pérdida de propiedad del cliente o proveedor

| Rol | Link |
| --- | --- |
| Plantilla | `https://docs.google.com/spreadsheets/d/1PPUDTSmo6mPqkjGMlLt7uKM09TL5MU_DlTxdf9l-cNw/edit` |
| Sistema | `https://docs.google.com/spreadsheets/d/1asICBqzuBkhpvD4tXdfB1VIkFNPyhiOGNv6SxaEcYMw/edit` |
| Pestaña plantilla | `Plantilla` |
| Trabajo | Archivero: una pestaña por reporte; **nombre = folio `DP-…`** (§2.1 opción 1); `copyTo` desde plantilla |
| Código | `backend/sgcF22Service.js` |
| Nota | El archivo sistema conserva histograma; no se escribe en la plantilla ni se reemplaza el libro entero |

### SGC-F-25 · Actividades posteriores a la entrega

| Rol | Link |
| --- | --- |
| Plantilla | `https://docs.google.com/spreadsheets/d/1kaE2ZDm2Za6PdZLEJMWyoBnj6TP2fkoc17W0sasleEM/edit` |
| Sistema | `https://docs.google.com/spreadsheets/d/1tXQx1lxhdHas40sS2tF97HoBOypwGP8Qjfrv5aM41Mk/edit` |
| Pestaña plantilla | `Plantilla` (legado aceptado: `Plantilla.`) |
| Historial | `SGCF25-MMAA`, `SGCF25-MMAA_2`, `_3`… (`versionarCadaCambioMes`) |
| Código | `backend/sgcF25Service.js` |
| Nota | Sin archivero. El archivo sistema conserva histograma y hojas legado `SGCF25-DDMM-NN`; no se escribe en la plantilla |

### SGC-F-27 · Reporte de verificación de equipos de medición (capítulo 7)

| Rol | Link |
| --- | --- |
| Plantilla | `https://docs.google.com/spreadsheets/d/1BzMshUJ9f2qqAaTl8xqY6Bwu6r_7L1PFyA8PW1VFRy8/edit` |
| Sistema | `https://docs.google.com/spreadsheets/d/1EK1xd8hJtpkDs_H7F_aoprV3eAz7bAmzIp9Fy0kHZy0/edit` |
| Pestaña plantilla | `Plantilla` |
| Trabajo | Archivero: una pestaña por verificación; **nombre = campo `Instrumento de medición`** (§2.1 opción 2); `copyTo` desde plantilla |
| Código | `backend/sgcF27MedicionService.js` (clave interna `SGC-F-27V`) |
| Nota | El archivo sistema conserva histograma; no se escribe en la plantilla. Clave UI: `sgc-f-27-medicion` (distinta de la orden de compra SGC-F-27 cap. 8) |

### SGC-F-28 · Comparativa de proveedores

| Rol | Link |
| --- | --- |
| Plantilla | `https://docs.google.com/spreadsheets/d/1QIXS3sn51MefyzwXam-HxIN_9bsdv37_F6ITnF_OHHo/edit` |
| Sistema | `https://docs.google.com/spreadsheets/d/1PxxA5U1Z0tOpbaj1eH8agdxOuQVgF8ya8VU2Uc9BhOI/edit` |
| Pestaña plantilla | `Plantilla` |
| Trabajo | Archivero: una pestaña por comparativa; **nombre = campo `Nombre de cotización`** (§2.1 opción 2); `copyTo` desde plantilla |
| Código | `backend/sgcF28Service.js` |
| Nota | El archivo sistema conserva histograma; no se escribe en la plantilla ni se reemplaza el libro entero |

### SGC-F-29 · Evaluación de proveedores

| Rol | Link |
| --- | --- |
| Plantilla | `https://docs.google.com/spreadsheets/d/1zDKhcGHhU7QArIidvj45mvtWHe_WuqO-pRqZ5QPT3KE/edit` |
| Sistema | `https://docs.google.com/spreadsheets/d/1_MsV1j-HuRUr8mdJogU0NmZL0j0zb35Ty5EtQ0cbCfQ/edit` |
| Pestaña plantilla | `Plantilla` |
| Historial | `SGCF29-MMAA`, `SGCF29-MMAA_2`, `_3`… (`versionarCadaCambioMes`); sin archivero |
| Código | `backend/sgcF29Service.js` |
| Nota | Criterios nuevos se insertan a la derecha de E (Precio→F) con borde; el sistema conserva histograma/hojas legado y no escribe en la plantilla |

---

## 10. Borrador local (UI) — obligatorio en todo formato con «Guardar información»

El preview (`sgc-plantilla-preview.component.ts`) usa `FormDraftService` (localStorage) para no perder ediciones al refrescar o quedarse sin red. Si el ciclo no se cierra bien, aparecen:

- Badge **«Cambios sin guardar»** aunque el servidor ya aceptó el guardado (`borradorLocalPendiente` sigue en `true`).
- Modal **«Borrador local encontrado»** al salir y volver (el borrador se reescribió al destruir el componente).

### Reglas fijas (copiar en cada formato nuevo)

1. Incluir el payload del formato en `obtenerPayloadBorradorLocalSgc()` / `aplicarPayloadBorradorLocalSgc()`.
2. En el `next` de **todo** `persistir*` (y variantes `Inmediato` / `ConClave`):

```ts
next: (res) => {
  this.limpiarBorradorLocalSgc(); // cancela debounce + borra localStorage + flag
  this.xxxGuardando = false;
  this.xxxCambiosPendientes = false;
  this.aplicarEstadoXxx(res, /* … */);
},
error: () => {
  this.persistirBorradorLocalSgcAhora(); // conservar trabajo si falló el servidor
  this.xxxGuardando = false;
}
```

3. **No** llamar `persistirBorradorLocalSgcAhora()` en `ngOnDestroy` / al salir si no hay cambios: `guardarAlSalirSgc()` solo respalda cuando `hayCambiosPendientesSgc` es `true`.
4. Al iniciar `guardarInformacionDriveSync()`, cancelar el timer de debounce del borrador (ya está en el método compartido) para que un `setTimeout` de 350 ms no reescriba el draft tras un guardado OK.
5. Referencia vigente: `persistirDgF05()` y `persistirSgcF18()` en `sgc-plantilla-preview.component.ts`.

### Checklist rápido UI

- [ ] Guardar con cambios → desaparece «Cambios sin guardar» y se actualiza Sync.
- [ ] Salir y volver sin editar más → **no** aparece «Borrador local encontrado».
- [ ] Editar, cortar red, Guardar → aviso de borrador local; al volver online, Guardar sincroniza y limpia.
