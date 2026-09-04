# Biznaga R&T - Sistema de Diseno SGC (Design System del modulo SGC)

Documento de referencia EXCLUSIVO del modulo **Sistema de Gestion de Calidad (SGC)**.

Su proposito es que cualquier persona (o el asistente de IA) pueda crear o ajustar un
formato SGC **sin tener que analizar cada componente desde cero**. Describe como se
comporta el modulo a nivel visual (frontend) y a nivel de datos (backend: Google
Drive / Sheets, historial, folios, formato de Excel).

> Importante: el SGC usa una identidad visual **propia (paleta teal)**, distinta del
> resto del sistema (verde Biznaga `#38512F`). NO mezclar ambas paletas. Para todo lo
> que NO sea SGC sigue aplicando `DESIGN-SYSTEM.md`.

---

## Indice

1. [Identidad visual SGC](#1-identidad-visual-sgc)
2. [Paleta de colores](#2-paleta-de-colores)
3. [Tipografia](#3-tipografia)
4. [Estructura de pantallas](#4-estructura-de-pantallas)
5. [Componentes UI reutilizables](#5-componentes-ui-reutilizables)
6. [El sistema `dg-f05-*` (formularios y tablas de captura)](#6-el-sistema-dg-f05-formularios-y-tablas-de-captura)
7. [Editor integrado (Google Workspace embebido)](#7-editor-integrado-google-workspace-embebido)
8. [Iconografia](#8-iconografia)
9. [Arquitectura backend de un formato SGC](#9-arquitectura-backend-de-un-formato-sgc)
10. [Sincronizacion con Google Drive / Sheets](#10-sincronizacion-con-google-drive--sheets)
11. [Historial y versionado](#11-historial-y-versionado)
12. [Folios](#12-folios)
13. [Formato visual en Excel / Sheets](#13-formato-visual-en-excel--sheets)
14. [Rutas HTTP](#14-rutas-http)
15. [Checklist para un formato nuevo](#15-checklist-para-un-formato-nuevo)
16. [Reglas obligatorias](#16-reglas-obligatorias)

---

## 1. Identidad visual SGC

El SGC tiene su propio lenguaje visual basado en **teal/verde azulado** (estilo SaaS
moderno, limpio, con tarjetas, acentos en gradiente y mucho aire). Es deliberadamente
distinto al verde corporativo del resto de la plataforma.

Caracteristicas clave:
- Hero con gradiente teal y overlay (clase `sgc-hero`).
- "Shell" (tarjeta contenedora) con una franja superior de acento (`sgc-shell-accent`).
- Tarjetas de capitulo / documento con borde sutil, hover elevado y `stripe` lateral.
- Tablas y formularios compactos con el prefijo `dg-f05-*` (sistema compartido).
- Botones tipo "pill" (`border-radius: 999px`) en blanco con borde teal.

Archivos base del modulo:

| Archivo | Rol |
|---------|-----|
| `src/app/pages/sistema-gestion-calidad/sistema-gestion-calidad.component.*` | Landing: capitulos ISO + documentacion extra |
| `sgc-formato-detalle.component.*` | Listado de documentos de un capitulo (breadcrumb + doc cards) |
| `sgc-plantilla-preview.component.*` | Maqueta interactiva / editor de cada formato |
| `sgc-documentacion-extra.component.*` | Repositorio de archivos sueltos |
| `sgc-formatos.catalog.ts` | Catalogo de capitulos y plantillas (IDs de Drive, slugs) |
| `sgc-formato.types.ts` | Tipos de UI (tarjetas, pasos) |

---

## 2. Paleta de colores

### Tokens SGC (teal) - obligatorios

```scss
$sgc-teal:        #15a596;  // acento principal
$sgc-teal-dark:   #0f766e;  // titulos, texto de acento, extremo de gradiente
$sgc-teal-soft:   rgba(21, 165, 150, 0.12);  // fondos suaves, badges
$sgc-teal-border: rgba(21, 165, 150, 0.38);  // bordes de control
$sgc-border:      rgba(15, 118, 110, 0.12);  // bordes de tarjeta
```

### Neutros (compartidos por las tablas/forms `dg-f05`)

```scss
$dg-f05-border:  #e8edf2;  // lineas de tabla / divisores
$dg-f05-text:    #1e293b;  // texto principal (slate-800)
$dg-f05-muted:   #64748b;  // texto secundario / labels (slate-500)
$dg-f05-surface: #f8fafc;  // fondos de cabecera de tabla / meta
$dg-f05-hover:   #f1f5f9;  // hover de fila
```

### Gradientes permitidos en SGC

```css
/* 1. Hero del modulo (overlay sobre header-bg-image) */
background: linear-gradient(135deg,
  rgba(21,165,150,0.62) 0%,
  rgba(15,118,110,0.78) 55%,
  rgba(9,82,74,0.88) 100%);

/* 2. Acento superior del shell y cabeceras de documento */
background: linear-gradient(90deg, #0f766e, #15a596 50%, #5eead4);   /* franja */
background: linear-gradient(135deg, #0f766e 0%, #15a596 100%);       /* doc header / badges */

/* 3. Stripe lateral de tarjeta de capitulo: usa los colores del catalogo (colorInicio/colorFin) */
background: linear-gradient(180deg, <colorInicio>, <colorFin>);
```

### Acento secundario (solo "Documentacion complementaria")

El bloque de documentacion extra usa **azul** (`#1e40af` / `#60a5fa`) para
diferenciarse de los capitulos ISO. Es la unica excepcion de color permitida.

### Colores por tipo de archivo (doc cards)

| Tipo | Acento | Icono/badge |
|------|--------|-------------|
| Excel | `#1d6f42` -> `#34a853` | `rgba(29,111,66,*)` |
| Word | `#2b579a` -> `#4472c4` | `rgba(43,87,154,*)` |
| PDF | `#b91c1c` -> `#dc2626` | `rgba(220,38,38,*)` |

NO introducir colores fuera de estos conjuntos en el modulo SGC.

---

## 3. Tipografia

El SGC hereda **Open Sans** del sistema global para la interfaz web. La escala es
**mas compacta** que la del design system general (es contenido tipo documento).

| Token | Valor | Uso |
|-------|-------|-----|
| `--hero-title` | `clamp(1.1rem, 2.5vw, 2rem)` / 700 | Titulo del hero SGC |
| `--intro-title` | `1.5rem` / 700 / `#0f766e` | Titulo de seccion dentro del shell |
| `--panel-title` | `0.9375rem` / 700 | Titulos de panel/seccion |
| `--card-title` | `0.9375rem` / 700 | Titulo de tarjeta (capitulo/documento) |
| `$dg-f05-font-section` | `0.75rem` / 700 | Cabecera de bloque de tabla |
| `$dg-f05-font-body` | `0.78rem` / 400 | Texto de inputs de captura |
| `$dg-f05-font-label` | `0.65rem` / 700 / uppercase | Labels y `<th>` de tabla |
| `--code` | `0.62rem` / 700 / uppercase | Codigo de formato (badge "DG-F-04") |

**Excepcion importante - documentos en Google Sheets:** los datos que el sistema
escribe en las hojas usan **Century Gothic, tamano 11** (ver seccion 13). Esto es
para que el Excel/Sheet resultante respete la tipografia de las plantillas oficiales,
NO Open Sans.

---

## 4. Estructura de pantallas

### 4.1 Hero (encabezado de pantalla SGC)

```html
<div class="header header-bg-image sgc-hero pb-6 pt-4 pt-md-6 d-flex align-items-center position-relative overflow-hidden">
  <div class="container-fluid d-flex align-items-center justify-content-center position-relative">
    <div class="row w-100 text-center">
      <div class="col-12">
        <div class="d-flex flex-column align-items-center justify-content-center">
          <div class="sgc-hero-icon icon icon-shape text-white rounded-circle shadow mb-2">
            <i class="fas fa-certificate" aria-hidden="true"></i>
          </div>
          <h1 class="text-white mb-0 sgc-hero-title">Titulo</h1>
          <p class="text-white mb-0 sgc-hero-tagline">Subtitulo opcional</p>
        </div>
      </div>
    </div>
  </div>
</div>
```

- Usa `header-bg-image sgc-hero`; el gradiente teal se aplica via `::before` en el SCSS.
- El icono va en `.sgc-hero-icon` con `background: rgba(255,255,255,0.18)`.
- A diferencia del design system general, **aqui SI se permite tagline/subtitulo**.
- Variante compacta para vistas de detalle: `sgc-hero--compact`.

### 4.2 Contenedor + Shell

```html
<div class="container-fluid sgc-main-wrap mt--5">
  <div class="row justify-content-center">
    <div class="col-12 sgc-content-col">
      <div class="card sgc-shell border-0 shadow-sm">
        <div class="sgc-shell-accent" aria-hidden="true"></div>
        <div class="card-body sgc-shell-body">
          <!-- contenido -->
        </div>
      </div>
    </div>
  </div>
</div>
```

- `mt--5` para montar el shell sobre el hero (igual que el resto del sistema).
- `sgc-content-col` ocupa el 100% (no `col-xl-11`): el SGC usa ancho completo.
- `sgc-shell`: `border-radius: 14-16px`, fondo blanco, sombra teal suave.
- `sgc-shell-accent`: franja superior de 3px con gradiente teal (firma visual del SGC).

### 4.3 Breadcrumb (vistas de detalle)

Usar `.sgc-crumb` con links tipo pill y el item actual con gradiente teal:

```html
<nav class="sgc-crumb">
  <div class="sgc-crumb__trail">
    <a class="sgc-crumb__link" ...>SGC</a>
    <span class="sgc-crumb__sep"><i class="fas fa-chevron-right"></i></span>
    <span class="sgc-crumb__current">Capitulo X</span>
  </div>
</nav>
```

---

## 5. Componentes UI reutilizables

### 5.1 Tarjeta de capitulo (`.sgc-chapter-card`)

`<button>` con: `glow` (radial con el color del capitulo), `stripe` lateral de 4px,
numero de capitulo, icono en cuadro redondeado, titulo, descripcion (2 lineas
truncadas), footer con badge de conteo + accion "Explorar". Hover: `translateY(-2px)`
+ sombra teal. Los colores salen del catalogo (`colorInicio`/`colorFin`).

### 5.2 Tarjeta de documento (`.sgc-doc-card`)

Para listar formatos de un capitulo. Modificadores por tipo: `--excel`, `--word`,
`--pdf`, `--disabled`. Estructura: `accent` (4px) + `icon` + `body` (code, tags, title,
desc) + `action` (circulo con flecha). Hover colorea la accion con teal.

### 5.3 Estado vacio (`.sgc-empty-state`)

Caja centrada con borde dashed teal, icono en cuadro `sgc-teal-soft`, titulo y texto.
Es el patron de "vacio" del SGC (NO usar el `fa-2x text-muted` del sistema general).

### 5.4 Badges / contadores

- Badge de conteo: `.sgc-chapter-badge` (teal) o `--empty` (gris) para "En preparacion".
- Contador circular: gradiente teal, `border-radius: 999px` (`.sgc-docs-section__count`).

### 5.5 Botones del SGC

```html
<!-- Accion primaria sobre barra (Guardar informacion): pill blanco con borde teal -->
<button class="btn btn-sm sgc-btn-save-info">
  <i class="fas fa-save mr-1"></i> Guardar informacion
</button>
```

- `.sgc-btn-save-info`: fondo blanco, texto/borde teal, `border-radius: 999px`,
  `padding: 0.4rem 1rem`. Variante `--on-dark` para barras oscuras.
- Estado guardando: cambiar icono a `fa-spinner fa-spin` y `disabled`.
- Indicador "Cambios sin guardar": `<span class="sgc-preview-sync sgc-preview-sync--hint">`.

---

## 6. El sistema `dg-f05-*` (formularios y tablas de captura)

Este es el **nucleo reutilizable** de las maquetas interactivas. Aunque el prefijo
viene de DG-F-05, lo usan casi todos los formatos (F-04, F-06, F-07, F-08, F-11,
F-12, F-14, F-18, etc.). Usalo siempre antes de inventar estilos nuevos.

### 6.1 Contenedor de documento

```html
<article class="dg-f05-doc">
  <header class="dg-f05-doc__header">
    <span class="dg-f05-doc__code">SGC-F-XX</span>
    <h3 class="dg-f05-doc__title">Nombre del formato</h3>
  </header>
  <div class="dg-f05-doc__meta"><!-- empresa, revision, fechas --></div>
  <!-- tabla(s) / campos -->
</article>
```

- `.dg-f05-doc`: tarjeta blanca, borde `#e8edf2`, `border-radius: 12px`.
- `.dg-f05-doc__header`: gradiente teal (`#0f766e -> #15a596`), texto blanco; el
  `__code` es un chip translucido y `__title` el nombre del formato.

### 6.2 Campos de captura

```html
<input class="dg-f05-field" ...>                 <!-- input/celda generica -->
<textarea class="dg-f05-field dg-f05-field--textarea"></textarea>
<select class="dg-f05-field dg-f05-field--select"></select>
<span class="dg-f05-field dg-f05-field--center">...</span> <!-- readonly numerico -->
```

- `.dg-f05-field`: borde invisible, fondo transparente, `font-size: 0.78rem`, se
  resalta el fondo en focus. Pensado para parecer una celda editable.
- `.dg-f05-field--select`: borde visible, focus teal (`#0d9488` + halo).

### 6.3 Tabla de captura

```html
<div class="dg-f05-table-wrap dg-f05-table-wrap--scroll">
  <table class="dg-f05-table sgc-fXX-table">
    <colgroup><col><col>...</colgroup>
    <thead><tr><th>...</th></tr></thead>
    <tbody><!-- filas con .dg-f05-field --></tbody>
  </table>
</div>
```

- `.dg-f05-table`: `table-layout: fixed`, `border-collapse: collapse`. Anchos por
  columna via `col:nth-child(n)` o clases `&__col--xxx`.
- `<thead> th`: `font-size: 0.65rem`, uppercase, color `#64748b`, fondo `#f8fafc`,
  `border-bottom: 2px solid #e8edf2`.
- Filas: `nth-child(even)` con fondo `rgba(248,250,252,.85)`, hover `#f1f5f9`.
- Columna de acciones: `.dg-f05-table__act` (ancho `1.75rem`).

### 6.4 Pie de tabla y boton agregar fila

```html
<div class="dg-f05-table-foot">
  <button class="dg-f05-row-btn dg-f05-row-btn--add">
    <i class="fas fa-plus"></i> Agregar fila
  </button>
</div>
```

- `.dg-f05-table-foot`: barra inferior con fondo `surface` y borde superior.
- `.dg-f05-row-btn`: boton fantasma (`color: #94a3b8`), variante `--add` para agregar.

### 6.5 Panel de tabla con cabecera propia

`.dg-f05-table-panel` agrupa una tabla bajo una cabecera con icono y titulo en teal
(`.dg-f05-table-panel__head`). Util para formatos con varios bloques (F-07, F-11).

---

## 7. Editor integrado (Google Workspace embebido)

Muchos formatos ofrecen, ademas de la maqueta, un **editor embebido** del documento
real de Google (Sheet/Doc/Slide) dentro de la plataforma. La barra superior del editor
usa estos patrones:

- Contenedor: `.sgc-preview-toolbar` (flex, space-between, wrap).
- Acciones a la derecha: `.sgc-preview-toolbar__actions`.
- Boton principal: `.sgc-btn-save-info` ("Guardar informacion").
- Boton de regreso: "Volver al formato".
- Solo `root` ve acciones destructivas como "Actualizar plantilla".

El flujo de guardado desde el editor manda `editorActivo: true` al backend, que en vez
de re-escribir celdas **importa** lo editado con `sincronizarDesdeDrive` (ver seccion 9).

---

## 8. Iconografia

- Libreria: **Font Awesome 5** (`fas fa-*`). El proyecto usa FA **5.3.1**: NO usar
  iconos exclusivos de FA6 (ej. `fa-diagram-project`, `fa-wand-magic-sparkles`). Sus
  equivalentes FA5 son `fa-project-diagram`, `fa-magic`.
- Icono del modulo: `fas fa-certificate`.
- Iconos por capitulo: definidos en `heroIconClass` del catalogo (ej. `fa-sitemap`,
  `fa-user-tie`).
- Accion/flechas: `fa-arrow-right`, `fa-chevron-right` (breadcrumb).
- Tipos de archivo: `fa-file-excel`, `fa-file-word`, `fa-file-pdf`.

---

## 9. Arquitectura backend de un formato SGC

Cada formato tiene un servicio en `backend/`. Convenciones de nombre de archivo:

| Patron | Ejemplo | `CODIGO_FORMATO` |
|--------|---------|------------------|
| `sgcDgF{NN}Service.js` | `sgcDgF04Service.js` | `DG-F-04` |
| `sgcF{NN}Service.js` | `sgcF14Service.js` | `SGC-F-14` |
| `sgcSgcF{NN}Service.js` | `sgcSgcF11Service.js` | `SGC-F-11` |
| caso especial | `sgcPo01Service.js`, `sgcMetodologiaAmefService.js` | `SGC-PO-01`, `SGC-DI-06` |

### 9.1 Capa central de persistencia: `sgcDgF05Service.js`

TODOS los formatos dependen de este servicio para el esquema y CRUD en MySQL
(`poolBiznagaSgc`, BD `DB_NAME_SGC` = `biznaga_sgc`). Expone, entre otros:

```js
module.exports = {
  asegurarTablaSgcFormatoDatos,   // crea/migra tablas sgc_formato_*
  persistirRegistroSgc,
  obtenerRegistroSgcPersistido,
  cargarFormato, guardarFormato, sincronizarDesdeDrive,
  actualizarPlantillaDesdeSistema, sanitizarDatos
};
```

Tablas: `sgc_formato_cabecera`, `sgc_formato_campos`, `sgc_formato_metadatos`,
`sgc_formato_catalogo_campos`.

### 9.2 API publica tipica de un servicio de formato (archetipo Sheets)

| Funcion | Rol |
|---------|-----|
| `cargarFormato(pool)` | Carga DB + Drive; si esta vacio, arranca desde plantilla |
| `guardarFormato(pool, body, options?)` | Guarda; si `body.editorActivo` -> `sincronizarDesdeDrive` |
| `sincronizarDesdeDrive(pool)` | Importa lo editado en el editor embebido |
| `actualizarPlantillaDesdeSistema(pool)` | Reset (solo `root`): re-sube desde `TEMPLATE_DRIVE_ID` |
| `sanitizarDatos(raw)` | Normaliza el JSON de entrada/salida |

Helpers privados que casi todos reimplementan: `parsearDatosDesdeHoja`,
`escribirDatosEnHoja`, `datosAActualizacionesSheet`, `actualizarDatosEnGoogleSheet`,
`resolverDriveFileId`, `resolverTituloHojaTrabajo`, `contenidoEsEquivalente`,
`estructuraEsEquivalente`, `construirRespuesta`.

### 9.3 Constantes al inicio del servicio (plantilla a copiar)

```js
const CODIGO_FORMATO = 'SGC-F-14';
const TEMPLATE_DRIVE_ID = '...';        // plantilla maestra (read-only)
const DRIVE_FILE_ID_SISTEMA = '...';    // copia viva que edita el sistema
const CARPETA_DRIVE_ID = '...';         // carpeta destino en Drive
const NOMBRE_ARCHIVO_DRIVE = 'SGC-F-14 ... (sistema)';
const SHEET_TITLE = 'Bitacora';         // hoja base de la plantilla
const HEADER_ROW = 5;
const DATA_START_ROW = 6;
const MAX_FILAS = 60;
const DATA_END_ROW = DATA_START_ROW + MAX_FILAS - 1;
const COLUMNAS = { folio: 1, nombreProyecto: 2, /* ... 1-based */ };
```

> Los IDs de Drive estan **hardcodeados por servicio** (no en `.env`). Rotarlos
> requiere tocar el codigo del servicio.

### 9.4 Respuesta estandar (`construirRespuesta`)

```js
return {
  codigo: CODIGO_FORMATO,
  datos: { ...datos },
  fechaElaboracionOriginal, fechaModificacionContenido, contenidoModificado,
  driveFileId,
  editorUrl: `https://docs.google.com/spreadsheets/d/${driveId}/edit?usp=sharing`,
  previewUrl: `https://docs.google.com/spreadsheets/d/${driveId}/preview`,
  ultimaSyncDrive
};
```

### 9.5 Tres archetipos de formato

| Archetipo | Tecnologia | Funciones extra |
|-----------|-----------|-----------------|
| **Sheets** (mayoria) | ExcelJS + Google Sheets API | el flujo descrito arriba |
| **Doc + PDF firmado** (DG-F-02/03/08, PO-01) | Google Docs API | `subirPdfFirmado`, `descargarPlantillaPdf`, `sincronizarPlantillaGoogleDoc` |
| **Especiales** | - | DG-F-01 (imagen mapa), AMEF (Slides), Documentacion extra (vault) |

---

## 10. Sincronizacion con Google Drive / Sheets

Helpers en `backend/driveService.js` usados por el SGC:

| Funcion | Uso |
|---------|-----|
| `descargarArchivo` / `exportarGoogleSheetComoXLSX` | Leer plantillas |
| `subirExcelComoGoogleSheet` | Primera publicacion como Sheet editable |
| `convertirOfficeExcelAGoogleSheet` | Migrar `.xlsx` -> Sheet nativo |
| `actualizarCeldasGoogleSheet` | Escritura incremental de celdas (en lotes, `CHUNK=200`) |
| `listarHojasGoogleSheet` / `duplicarHojaGoogleSheet` / `eliminarHojasGoogleSheet` | Historial |
| `obtenerDimensionesHojaGoogleSheet` | `_metaHoja` (rowCount/columnCount) |
| `reemplazarArchivoEnDrive` | Reemplazo in-place de `.xlsx` |
| `aplicarFormatoFilasSgcF14`, `aplicarFormatoFilasDgF05`, `aplicarFormatoVisualSgcF06/11/12` | Formato visual por formato |

### Resolucion del archivo de Drive

1. Preferir `DRIVE_FILE_ID_SISTEMA` si existe dentro de `CARPETA_DRIVE_ID`.
2. Si no, buscar el archivo mas reciente cuyo nombre empiece con `NOMBRE_ARCHIVO_DRIVE`.
3. En el primer guardado: subir/convertir como Google Sheet nativo.

### Resolucion de la hoja activa

- **Hoja vigente** = la hoja de historial con fecha mas reciente; si no hay, la hoja
  base `SHEET_TITLE`. Via `resolverTituloHojaVigenteDesdeDrive(spreadsheetId, SHEET_TITLE, CODIGO_FORMATO)`.
- **Hoja de edicion** = la hoja base de la plantilla.

---

## 11. Historial y versionado

Servicio: `backend/sgcExcelHistorialService.js`. Zona horaria: `America/Mexico_City`.

Hay **dos tipos de cambio**:

| Tipo | Cuando | Efecto |
|------|--------|--------|
| `informacion` | Cambio de datos (captura normal) | Archiva hoja `CODIGO-MMAA` (ej. `SGCF14-0626`) y **reutiliza** la del mes; NO toca revision |
| `formato` | Cambio estructural (filas/columnas de la plantilla) | Archiva hoja corta `alias_rNN` (ej. `FODA_r00`) e incrementa `Revision` + `Fecha Rev.` |
| `ninguno` | Sin cambios | Parchea en sitio |

Clasificacion en `clasificarTipoCambio` usando los callbacks del servicio:
`contenidoEsEquivalente` y `estructuraEsEquivalente`.

### `estructuraEsEquivalente` por formato

| Formato | Implementacion |
|---------|----------------|
| Generico por filas | comparar longitudes de arreglos |
| DG-F-04 | `estructuraSeccionesDgF04Equivalente` |
| SGC-F-07 / F-06 | comparar `auditorias.length` / `auditores.length` |
| **SGC-F-14** | **siempre `true`** (agregar/quitar proyectos = "informacion") |

> Decision clave: si agregar/quitar filas es captura normal del usuario, haz que
> `estructuraEsEquivalente` devuelva `true`. Asi el cambio se clasifica como
> "informacion" y se reutiliza la hoja del mes, evitando hojas duplicadas
> (`SGCF14-0626_2`). `aplicarHistorialEnDrive` ya borra esos `_N` sobrantes.

`_metaHoja` (rowCount/columnCount) se guarda en los datos para detectar cambios
estructurales reales aunque el JSON parezca igual.

---

## 12. Folios

Nomenclatura SGC-F-14: **`PM-DDMMAA-NN`** (dia-mes-anio + consecutivo de 2 digitos).

- La generacion vive en el **frontend** (`generarFolioSgcF14` en
  `sgc-plantilla-preview.component.ts`); el backend solo lee/escribe el string `folio`.
- El consecutivo se calcula contra los folios ya presentes del mismo dia.

```ts
const fechaTag = `${dd}${mm}${aa}`;
fila.folio = `PM-${fechaTag}-${String(consecutivo).padStart(2, '0')}`;
```

Para un formato nuevo con folio, replica este patron en el frontend y deja el backend
como pass-through del campo.

---

## 13. Formato visual en Excel / Sheets

Cuando el sistema escribe datos en la hoja, aplica formato programatico (Google Sheets
API `batchUpdate`) para que coincida con la plantilla oficial.

### Tipografia de los datos

- **Century Gothic, tamano 11** para las celdas que llena el sistema (NO la fuente
  "predeterminada" de Sheets).

```js
const textFormat = { fontFamily: 'Century Gothic', fontSize: 11 };
// repeatCell -> userEnteredFormat.textFormat
// fields: 'userEnteredFormat(horizontalAlignment,verticalAlignment,wrapStrategy,textFormat)'
```

(F-11 usa Century Gothic 12 con encabezados en negrita; ajusta segun la plantilla.)

### Bordes

- Regla actual de F-14: aplicar **solo el borde inferior** de cada fila con datos
  (`bottom` + `innerHorizontal`), respetando el resto de la cuadricula de la plantilla.
- Al limpiar filas vacias debajo, quitar **solo** `bottom` + `innerHorizontal` (no
  tocar `top` para no borrar el borde inferior del ultimo renglon con datos).

### Celdas combinadas (merge) tras escribir

- Primero **desfusionar** el bloque de datos, luego **re-fusionar** por fila.
- SGC-F-14: `B:C` (nombre del proyecto) y `G:H` (% avance) por cada fila.
- DG-F-05: `H:I` (seguimiento) por fila.

### Alineacion

- Centradas: folio, prioridad, estatus, % avance. Izquierda: nombre, responsable.
- Siempre `verticalAlignment: MIDDLE` y `wrapStrategy: WRAP`.

La funcion de referencia es `aplicarFormatoFilasSgcF14` en `driveService.js`. Para un
formato nuevo, crea su propia `aplicarFormatoFilas<Codigo>` siguiendo el mismo patron
(tipografia + alineacion + merges + bordes minimos) y llamala desde la
`aplicarFormatoVisual<Codigo>` del servicio.

---

## 14. Rutas HTTP

- Prefijo: `/api/sgc/`
- Auth: `requireAdminOrSgc` (roles `root`, `administrador`, `sgc`).
- Slug = codigo en kebab-case minusculas (`DG-F-04` -> `dg-f-04`; AMEF -> `metodologia-amef`).

| Metodo | Ruta | Handler |
|--------|------|---------|
| GET | `/api/sgc/formatos/{slug}` | `cargarFormato` |
| POST | `/api/sgc/formatos/{slug}/guardar` | `guardarFormato` |
| POST | `/api/sgc/formatos/{slug}/sincronizar-drive` | `sincronizarDesdeDrive` |
| POST | `/api/sgc/formatos/{slug}/actualizar-plantilla` | `actualizarPlantillaDesdeSistema` (**solo `root`**) |
| POST | `/api/sgc/formatos/{slug}/subir-pdf-firmado` | formatos Doc |
| GET | `/api/sgc/formatos/{slug}/descargar-plantilla-pdf` | formatos Doc |
| GET/POST | `/api/sgc/documentacion-extra[...]` | repositorio extra |

Respuesta: `{ success: true, message, ...construirRespuesta(...) }`. Errores via
`handleError(res, error, '...')`.

---

## 15. Checklist para un formato nuevo

### Frontend
- [ ] Registrar la plantilla en `sgc-formatos.catalog.ts` (codigo, titulo, nombre de
      archivo en Drive, `driveFileId`, `previewSlug`, `previewMode: 'form'`).
- [ ] Maquetar en `sgc-plantilla-preview.component.html` reusando `dg-f05-*`
      (`dg-f05-doc`, `dg-f05-table`, `dg-f05-field`).
- [ ] Toolbar con `sgc-btn-save-info` + indicador "Cambios sin guardar".
- [ ] Si lleva folio, replicar el patron `PM-DDMMAA-NN` en el `.ts`.

### Backend
- [ ] Crear `backend/sgc<...>Service.js` con las constantes (seccion 9.3).
- [ ] Implementar `cargarFormato`, `guardarFormato`, `sincronizarDesdeDrive`,
      `actualizarPlantillaDesdeSistema`, `sanitizarDatos`.
- [ ] Apoyarse en `sgcDgF05Service` (persistencia) y `sgcExcelHistorialService` (historial).
- [ ] Crear `aplicarFormatoFilas<Codigo>` en `driveService.js` (Century Gothic 11 +
      alineacion + merges + bordes minimos).
- [ ] Definir `estructuraEsEquivalente` segun si agregar/quitar filas es captura normal.
- [ ] Registrar rutas en `server.js` con `requireAdminOrSgc` (y `root` para reset).

---

## 16. Reglas obligatorias

### Visual
- Usar SOLO la paleta teal SGC (`#15a596`, `#0f766e`, ...) + neutros `dg-f05`.
  Unica excepcion: azul en "Documentacion complementaria" y colores por tipo de archivo.
- NO usar el verde corporativo `#38512F` ni gradientes del design system general.
- Hero siempre con `header-bg-image sgc-hero`; shell siempre con `sgc-shell-accent`.
- Reusar `dg-f05-*` antes de crear estilos nuevos de tabla/formulario.
- Botones de accion del SGC = pill blanco con borde teal (`sgc-btn-save-info`).
- Iconos Font Awesome **5** (no FA6).

### Datos / Drive
- Tipografia de datos escritos en Sheets: **Century Gothic 11** (no "predeterminado").
- Bordes al agregar datos: **solo borde inferior**, respetando la plantilla.
- Re-aplicar merges por fila tras escribir (desfusionar -> escribir -> fusionar).
- Reutilizar la hoja del mes para cambios de "informacion"; nunca duplicar (`_N`).
- IDs de Drive como constantes del servicio; zona horaria `America/Mexico_City`.
- Toda ruta SGC bajo `/api/sgc/` con `requireAdminOrSgc`; reset de plantilla solo `root`.

---

Version: 1.0.0
Modulo: Sistema de Gestion de Calidad (SGC)
Proyecto: Biznaga R&T
Complemento de: `DESIGN-SYSTEM.md` (sistema general)
