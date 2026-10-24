# Guía: plantilla Excel externa → archivo dinámico del sistema (SGC)

Checklist para implementar en **otro formato** la misma idea que DG-F-05 (referencia vigente):  
diseño en un Google Sheet **plantilla** (aparte) y trabajo/historial en un Google Sheet **sistema** (dinámico).

No cubre reglas de diseño (bordes, colores, anchos, merges visuales). Solo el flujo de archivos y sync.

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
| Convención de pestañas de historial | _ej. `DGF05-MMAA` → adapta al código_ |
| Versionado dentro del mismo mes | _1ª = `CODIGO-MMAA`; 2ª = `CODIGO-MMAA_2`; 3ª = `_3`…_ |
| Pestaña de trabajo vigente | _siempre la última versión del mes; no reescribir meses previos_ |

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
5. **No** crear pestañas `Alias_r00` / `Partes_r00` (historial de “formato”). Solo pestañas `CODIGO-MMAA` / `CODIGO-MMAA_N`.

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
- [ ] Definir `CODIGO_FORMATO` y convención `CODIGO-MMAA` / `CODIGO-MMAA_N`.
- [ ] Constantes `TEMPLATE_*` y `DRIVE_FILE_ID_SISTEMA` en el servicio.
- [ ] `resolverDriveFileId`: priorizar sistema; rechazar plantilla como archivo de trabajo.
- [ ] Historial: `soloHistorialInformacion: true` + `versionarCadaCambioMes: true` (sin `Alias_rNN`).
- [ ] Al cargar: si falta hoja del mes → copiar plantilla; editor abre la **última** `_N` del mes.
- [ ] Al guardar: nueva versión del mes (`_2`, `_3`…); si estructura mala → regenerar solo la vigente.
- [ ] Historial: no regenerar meses anteriores ni versiones previas del mes.
- [ ] Endpoint / UI con `editorUrl` del **sistema** (gid de la última versión del mes).
- [ ] Borrador local UI: en el `next` de `persistir*` llamar `limpiarBorradorLocalSgc()`; en `error`, `persistirBorradorLocalSgcAhora()` (ver §10).
- [ ] Probar: 3 guardados en el mismo mes → `CODIGO-MMAA`, `_2`, `_3`; meses viejos intactos.
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
- cada guardado del mes crea CODIGO-MMAA, luego CODIGO-MMAA_2, _3… (versionarCadaCambioMes)
- nunca pestañas Alias_rNN / Partes_r00
- nunca escribir en la plantilla ni borrar historial de meses/versiones previas
- datos de BD/payload solo en la última versión del mes
- reutilizar driveService.copiarHojaEntreSpreadsheets y el patrón de sgcDgF05Service
  (adoptarPlantillaEnSistema / reescribirHojaDesdePlantilla / versionarCadaCambioMes)
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

### DG-F-04 · Análisis FODA (referencia anterior)

| Rol | Link |
| --- | --- |
| Plantilla | `https://docs.google.com/spreadsheets/d/1WKgNlkGR481eOhwl_wv4l5HaVj8pt3FR4oF4I_1GTuc/edit` |
| Sistema | `https://docs.google.com/spreadsheets/d/1VfHOIJEeCJ8QZNYdWp6spszmcFKq_ZNVDn24oX8Rj9I/edit` |
| Código | `backend/sgcDgF04Service.js` |
| Nota | Preferir el patrón de versionado de DG-F-05 en formatos nuevos |

### SGC-F-18 · Tabla de requisitos legales y reglamentarios

| Rol | Link |
| --- | --- |
| Plantilla | `https://docs.google.com/spreadsheets/d/1KuD6RwHRedvqsot39ulw5Gps5uUKbK6OzvVlWyELDpU/edit` |
| Sistema | `https://docs.google.com/spreadsheets/d/1Ge8QOuUhgrnpEWBH4oTXi4orwDuLsXZKz-ApaLWErSk/edit` |
| Pestaña plantilla | `Plantilla` |
| Historial | `SGCF18-MMAA`, `SGCF18-MMAA_2`, `_3`… (`versionarCadaCambioMes`) |
| Código | `backend/sgcSgcF18Service.js` |

### SGC-F-11 · AMEF

| Rol | Link |
| --- | --- |
| Plantilla | `https://docs.google.com/spreadsheets/d/1mR9vTvMRJ_E0-416ujaCkDqg1hwPKpujZN0OQ8AseZE/edit` |
| Sistema | `https://docs.google.com/spreadsheets/d/15iP8UalTLSW83DDuEmQEPZaAG3zao06zO51guKiR9_k/edit` |
| Pestaña plantilla | `Plantilla` |
| Trabajo | Una pestaña por análisis del archivero (nombre = proceso); nuevas hojas = `copyTo` desde plantilla externa |
| Código | `backend/sgcSgcF11Service.js` |
| Nota | El archivo sistema conserva histograma/guías; no se escribe en la plantilla |

### SGC-F-12 · Notificación de cambios al SGC

| Rol | Link |
| --- | --- |
| Plantilla | `https://docs.google.com/spreadsheets/d/1TyIqkHtAZGy405u7lNCq-j1LzW-dMxRjWG4LzMwonJg/edit` |
| Sistema | `https://docs.google.com/spreadsheets/d/1Disbn6atnNc6L56D6axW0Y4hCSqspK2SfStbujGQf78/edit` |
| Pestaña plantilla | `Plantilla` |
| Trabajo | Una pestaña por notificación del archivero (nombre = folio `CAM-…`); nuevas hojas = `copyTo` desde plantilla externa |
| Código | `backend/sgcSgcF12Service.js` |
| Nota | Igual que SGC-F-11: el archivo sistema conserva histograma; no se escribe en la plantilla ni se reemplaza el libro entero |

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
