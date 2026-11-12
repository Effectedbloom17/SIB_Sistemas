# Adaptabilidad responsiva del frontend (móvil)

Guía de trabajo para adaptar pantallas del sistema BIZNAGA R&T a teléfonos.
Sirve para el agente y para el equipo: al adaptar una página nueva o corregir una
ya hecha, seguir estos patrones **sin que el usuario tenga que repetirlos**.

Cuando se aprenda o se pida un patrón nuevo, **actualizar este archivo** y también
`.cursor/rules/responsive-mobile.mdc` (resumen corto, alwaysApply).

---

## 1. Alcance y reglas de oro

1. **Solo móvil.** Los cambios van bajo `@media (max-width: 767px)` (o `767.98px`).
   La vista de PC / escritorio **no se toca** salvo que el usuario lo pida.
2. **Breakpoint principal:** `max-width: 767px` (teléfono).
   En gráficas a veces se usa `680px` / `640px` por el ancho del chart, no del viewport.
3. **No reiniciar** backend ni arrancar `npm start` / `ng serve`. El usuario arranca el sistema.
4. **Legibilidad primero.** Muchos usuarios son adultos: tipografía cómoda, poco texto
   comprimido, preferir 2 columnas si con 3 la letra queda pequeña.
5. **Animaciones suaves** en entradas, aperturas, paginación y botones expandibles.
6. Al terminar un cambio de código, subir el **patch** de versión en `package.json`.

---

## 2. Checklist al adaptar una pantalla

1. Revisar hero / título: dejar espacio bajo la navbar (`padding-top` ~4.4–4.6rem).
2. Controles relacionados en la misma fila (etiqueta arriba de cada uno).
3. Listados: compactar a fila o cuadrícula según el tipo (ver §4).
4. Detalle largo: modal / sheet con fondo difuminado, no meter todo en la tarjeta.
5. Gráficas: `touch-action: pan-y`; etiquetas cortas si se enciman.
6. Quitar scroll anidado innecesario (`overflow-y: auto` + `overscroll-behavior: contain`).
7. Animación de entrada corta en tarjetas / bloques.
8. Probar en teléfono (LAN) y confirmar que el scroll vertical sigue funcionando.
9. Actualizar este `.md` si aparece un patrón nuevo.
10. Bump de versión patch.

---

## 3. Patrones generales de layout

### 3.1 Controles y filtros

- Pares relacionados (**Año + Empresa**, **Empresa + Buscar**, etc.) en **una sola fila**.
- Etiqueta arriba de cada control.
- Botón “Limpiar” / acción secundaria puede ir debajo a lo ancho.
- Hasta **3 indicadores** de una gráfica o de estadísticas en una sola fila
  (icono arriba, texto corto que puede partirse en 2 líneas).
- **Menos filas = mejor.** Si hay 2–3 botones de acción relacionados (p. ej.
  Descargar PDF + Abrir editor), van **en la misma fila** (comparten ancho), no
  apilados a lo ancho salvo que el usuario lo pida.

### 3.1b Tablas densas (muchas columnas)

- Si la tabla de escritorio tiene muchas columnas y se aplasta en teléfono:
  **mantener la misma tabla** y poner **scroll horizontal** en el contenedor
  (`overflow-x: auto`, `min-width` en la tabla, `-webkit-overflow-scrolling: touch`).
- No convertir automáticamente a tarjetas salvo que el usuario lo pida.
- El scroll vertical de la página debe seguir funcionando (`touch-action: pan-x pan-y`
  en el wrap de la tabla).
- **Nada fuera de la celda:** fechas, badges y textos no deben invadir la columna
  de al lado. Usar `overflow: hidden` en `td`/`th`, `min-width` realista por
  columna (p. ej. fecha `dd/mm/yyyy` ≥ ~5.75–6.25rem) y padding interno suficiente.
  Evitar `overflow: visible` / `max-width: none` en celdas de tablas fijas.

### 3.2 Dos bloques relacionados

Ejemplo: **Cursos de hoy** + **Próximos cursos**.

- Misma fila, dos columnas.
- Se conserva el título; se oculta la descripción larga.
- Dentro de la columna angosta, nombre y horario pueden partirse en 2 líneas.

### 3.3 Criterios / leyendas

- Hasta **3 criterios** de una distribución (leyenda o resumen) en un solo renglón.

### 3.3b Documentos / archivos / miniaturas

- Si el ítem es documento, archivo o imagen (tarjeta compacta), priorizar
  **3 por fila** en móvil para usar poco espacio.
- Si con 3 la lectura o el toque se rompe (pantalla muy angosta), bajar a **2**.
- Compactar: título corto (2 líneas), sin descripción larga; acciones en icono.

### 3.4 Hero y shell

- Hero con imagen de fondo: `padding-top` suficiente para no chocar con la navbar
  (`~4.5rem`).
- **Títulos del SIB (hero):** no deben casi chocar con el icono de arriba ni con
  la tarjeta blanca de abajo. Dejar aire claro:
  - Espacio icono → título (`margin-bottom` del icono ~0.7rem).
  - `padding-bottom` del hero holgado (`~4.4rem`) si el contenido usa `mt--5`.
  - En móvil, suavizar el solape: `margin-top` del bloque principal ~`-2.4rem`
    en lugar del negativo fuerte de escritorio.
  - Título con `line-height` ~1.3 y un poco de padding horizontal.
- Título un poco más chico en teléfono (`~1.28–1.35rem` suele bastar).
- Flechas de carrusel de vistas del dashboard: ocultas en móvil; las pastillas
  ocupan el ancho de forma equitativa.
- Iconos en etiquetas (p. ej. lupa de “Buscar…”): no deben cortarse. Si el
  contenedor tiene `overflow: hidden` (p. ej. card redondeada), el `.row` de
  Bootstrap con margen negativo puede cortar el icono: en móvil quitar ese
  margen (`margin-left/right: 0`) y dejar el label en `inline-flex` con
  `overflow: visible`.
- Navbar en móvil: iconos más chicos (~36px; ~32px bajo 480px), `flex-shrink: 0`
  y un poco de aire entre lupa y avatar para que no se monten ni se corten.

---

## 4. Listados: qué mostrar y cómo abrir el detalle

### 4.1 Cursos (agenda / próximos)

- **Una fila por curso:** nombre del curso + horario.
- Empresa, instructor y cupo van al **detalle**.
- Detalle: diálogo fijo, fondo `rgba` + `blur`, cierre con X / backdrop / Escape.
- Bloquear `body` overflow mientras el modal está abierto; restaurarlo al cerrar
  y en `ngOnDestroy`.

### 4.1b Catálogo / Categorías de cursos (`/` home)

- Hero con `padding-top` bajo la navbar; título legible (~1.28rem).
- Botón **Gestionar Cursos** a lo ancho debajo del título.
- **Categorías en cuadrícula de 2 por fila** (legibilidad; no 3).
- En cada tarjeta: icono, nombre de categoría, conteo y botón Ver; tipografía
  cómoda; poco padding vacío; animación de entrada escalonada.
- Resultados de búsqueda de cursos: también **2 por fila** en móvil.
- El toque sigue navegando a la categoría / curso (misma acción de PC).

### 4.1c Cursos dentro de una categoría (`/cursosbiz/...`)

- Hero con espacio bajo la navbar; título de la categoría legible.
- Título + **Volver** en el encabezado del card; búsqueda a lo ancho.
- **Cursos en cuadrícula de 2 por fila** (mismo criterio de legibilidad).
- Tarjeta: imagen compacta, nombre legible, descripción corta (2 líneas),
  botón Ver Curso y horas; animación de entrada; poco hueco vacío.
- El toque abre el curso (misma acción de PC).

### 4.1d Información General / gestión documental del curso

- Hero con aire (icono → título → tarjeta), igual que el resto del SIB.
- Barra del curso: volver + nombre legible; meta en máx. 2 líneas.
- Acciones (**Agregar básicos…**, **Asignar documento**): **una debajo de otra,
  a lo ancho** (no amontonadas en wrap raro).
- Documentos principales / complementarios: **3 por fila** (o **2** bajo ~380px);
  tarjetas compactas; acciones en icono; animación de entrada corta.

### 4.1e Control de Capacitación Empresarial (`/control-capacitacion`)

- Hero con aire; botones del documento oficial **en la misma fila** (no anchos
  apilados).
- Búsqueda a lo ancho; filtros en **rejilla 2×2** (empresa/mes, estatus/descargas);
  Limpiar a lo ancho si aplica. Lupa del buscador sin cortarse.
- Tabla: **igual que en PC**, con **scroll lateral** en móvil (no tarjetaizar).
- Hint largo del encabezado se puede ocultar; tipografía cómoda.

### 4.1f Asignación / Programar curso (`/asig-curso`)

- Hero con aire.
- **Menos filas:** Curso a lo ancho; Empresa + Instructor misma fila; Fecha + Hora
  inicio + Hora fin en **una fila**; Modalidad + Cupo misma fila; Lugar a lo ancho.
- Botones Limpiar + Programar en la **misma fila**.
- Inputs (`date`/`time`/`number`/correos): padding interno y `overflow` para que
  el valor no se salga del margen del campo.

### 4.1g Cursos activos / programados (`/curso-activos`)

- Hero con aire; búsqueda a lo ancho; filtros empresa/estatus en **misma fila**.
- Tabla densa: **misma tabla + scroll lateral** (`min-width` real, no `min-width: 100%`
  que aplasta columnas).
- Fecha/horario en una sola línea (`nowrap`) dentro de la celda; nada fuera del margen.
- Preview de timeline: el botón **Abrir capacitación** va **al final (derecha)** de la
  línea de tiempo, igual que en PC (no debajo centrado).

### 4.1h Gestionar Curso (`/gestionar-curso`)

- Hero con aire; cabecera del curso con Volver en la misma fila (compacto).
- **Acciones rápidas en 2 columnas** (menos filas; no apilar botones a lo ancho).
- Detalles del curso: **2 datos por fila** (instructor/fechas, horario/modalidad, etc.).

### 4.1i Historial de cursos finalizados (`/historial-cursos`)

- Hero con aire; en móvil **sin toggle Normal/Compacto** (Compacto solo en PC);
  Alertas alineado a la derecha.
- Filtros: búsqueda a lo ancho; **estado + municipio** en una fila; anexo debajo.
- Año + mes del historial en **una fila**.
- Lista de empresas con padding cómodo (conteos sin pegarse al borde).
- Empty “selecciona empresa” **debajo** de la lista (no al costado); stats 2/fila.
- Layout móvil siempre **1 columna** (nunca el panel vacío pegado a la derecha).
- Al tocar una empresa se **ocultan lista + instrucciones** y se muestra el
  panel de cursos (volver con **Quitar selección**).

### 4.1j Historial de Constancias y DC-3 (`/historial-constancias-dc3`)

- Hero con aire (icono → título; `mt--5` suavizado).
- Guía de nomenclatura: hint debajo del título; chips sin desborde; leyenda
  **2 por fila**.
- Búsqueda a lo ancho con lupa dentro del input (entera); **Buscar + Limpiar**
  en la **misma fila**.
- Resultados: **misma tabla + scroll horizontal**; `min-width` por columna;
  textos/badges dentro de la celda (`overflow: hidden`).

### 4.1n Historial PC (`/proteccion-civil/historial-pc`)

- Hero con aire; en móvil **sin toggle Normal/Compacto** (solo PC).
- Filtros: búsqueda a lo ancho; **estado + municipio** juntos.
- Año + mes del historial en **una fila**.
- Empty “selecciona empresa” **debajo** de la lista (no al costado); stats 2/fila.
- Al tocar empresa se **ocultan lista + instrucciones** y se muestra el panel
  de trámites (volver con **Quitar selección**).

### 4.1m Control de Resolutivos PIPC (`/proteccion-civil/control-resolutivos`)

- Hero con aire (título + SP-F-29).
- Acciones del documento (**Descargar PDF / Actualizar / Abrir editor**) en
  **una sola fila**.
- Herramientas (Importar + Vista comprimida) en la misma fila con el conteo.
- Filtros: búsqueda a lo ancho; selects/fechas en **2 por fila**.
- Resultados: **misma tabla + scroll** (`min-width` real); celdas sin truncar.
  Encabezado fijo al scrollear vertical; columnas **Item** y **Empresa** fijas
  al scrollear horizontal (contexto al ver estatus/fechas). Nombre de empresa
  más angosto, **máx. 2 líneas** + `…` si no cabe.

### 4.1l PIPC Activos (`/proteccion-civil`)

- Hero con aire.
- KPIs: **hasta 3 por fila** (5 → 3+2 centrados; bajo 400px → 2).
- Panorama: Total / Dominante / Atención en **1 fila** con hints legibles.
- Estatus operativo: criterios en **grid 2×2**; conteo + % siempre visibles.
- Atención de resolutivos: chips en rejilla; KPI+Abrir misma fila si cabe;
  tarjetas **completas** (no compactar a grid de 3).
- PIPC gestionados / terminados: búsqueda a lo ancho; estado+municipio juntos;
  empresas en **grid 2** con responsable, ubicación y badges **sin cortar**.

### 4.1k Asignación de PIPC (`/proteccion-civil/asignacion-pipc`)

- Hero con aire; subtítulo legible.
- Pestañas **Desplegar / PIPC / Directorios** en **una sola fila** (etiquetas
  cortas + icono arriba); no dejar el activo empujando texto a la derecha.
- Desplegar: empresa y responsable apilados; lupa entera; placeholder compacto;
  chip de empresa con Guardar visible.
- Gestión de PIPC: sin título duplicado embebido; **Subir** a lo ancho;
  categorías en lista a lo ancho; hojas/formatos en **cuadrícula 3 por fila**
  (2 si angosto bajo 400px), tarjetas cortas con subtítulo/meta visibles;
  acciones Editor+descarga misma fila;
  otras categorías = tabla + scroll.
- Directorios: botón registrar a lo ancho; búsqueda a lo ancho; tarjetas
  **3 por fila** (2 si angosto); Editar + iconos en la misma fila.

### 4.1o Expedientes Médicos (`/expedientes-medicos`)

- Hero con aire (icono → título; solape suave con la tarjeta).
- Selector de empresa: título + búsqueda a lo ancho (lupa entera); tarjetas
  **2 por fila** (logo arriba; RFC, ubicación, barra de historias y
  “Ver expedientes” legibles).
- Menú empresa: **Iniciar Formulario + Historial** en la **misma fila**.
- Formulario Historia Clínica: campos cortos en **3 por fila** (fecha/matrícula/área,
  escolaridad/estado civil/edad); el resto **2 por fila**; Domicilio a lo ancho;
  **Cancelar/Anterior + Siguiente** en la misma fila.
- Historial: **Nueva Historia** a lo ancho; KPIs en **2×2**; búsqueda a lo ancho;
  Tipo+Desde juntos; **misma tabla + scroll** horizontal.

### 4.1p Audiometría (`/audiometria`)

- Mismo patrón que Expedientes Médicos.
- Hero con aire; empresas **2 por fila**; búsqueda a lo ancho + lupa.
- Menú: **Iniciar formulario + Historial** en la misma fila.
- Formulario: campos **2 por fila**; cortos en **3** (fecha/área/edad; sí/no
  triples); stepper con scroll horizontal (etiquetas sin partir a medias);
  Anterior+Siguiente misma fila.
- Historial: búsqueda a lo ancho; **misma tabla + scroll**.

### 4.1q Estadísticas Médicas (`/estadisticas-medicas`)

- Hero con aire; carrusel Expedientes/Audiometría **por encima** del solape
  con la tarjeta (padding-bottom holgado + `bottom` del carrusel; `mt` suave).
- Controles: **Generar Reporte + empresa** en la **misma fila**.
- KPIs: **hasta 3 por fila** (5 → 3+2 centrados; bajo 400px → 2).
- Gráficas emparejadas (`stat-grid-2`): **2 por fila**; tríos (`stat-grid-3`)
  apilados (leyendas necesitan ancho).
- Leyendas Apex: wrap **2–3 por renglón**, sin desborde; `touch-action: pan-y`
  en charts (scroll de página).
- Etiquetas de ejes/categorías en UTF-8 correcto (sin mojibake).

### 4.1r Sistema de Gestión de Calidad (`/sistema-gestion-calidad`)

- Hero Indicadores con aire; solape suave (`mt--5` atenuado).
- KPIs superiores **3 por fila**; inferiores **3+2 centrados** (bajo 400px → 2).
  No apilar a 1 columna en teléfono.
- Filtro año a lo ancho; mini-KPIs del carrusel en **3** (o 2) por fila.
- Charts: `touch-action: pan-y`; dual chart apilado en móvil; donuts centrados
  en caja fija (sin sticky ni desborde). La tarjeta del carrusel hace scroll
  y muestra leyenda, botón y textos completos (quejas, auditorías, proyectos).
- Leyenda donut (Excelente/Bueno/Regular/Malo): **2 por fila**.
- Donas del carrusel en caja de **200px** centrada (mismo tamaño que la gráfica). Quejas y eficacia: reglas de color en **una fila**.
- Formatos corporativos: búsqueda a lo ancho + lupa; capítulos en **carrusel
  1 fila** (flechas y dedo **desplazan** la fila, no seleccionan); documentos
  en **2 columnas** (6 por página), todas del mismo alto, y el bloque reserva siempre 3 filas aunque haya menos: icono fijo a la izquierda y solo el nombre, de izquierda a derecha.

### 4.1s Procedimientos SGC (`/sistema-gestion-calidad/procedimientos`)

- Hero con aire (icono, lema y título); solape suave con la tarjeta.
- Subir procedimiento a lo ancho; la búsqueda va justo debajo (sin hueco).
  La lupa no se corta.
- Áreas en **2 por fila** (prefijo, nombre en 2 líneas y conteo).
- PDFs en **2 por fila**: miniatura, código, nombre y acciones en icono.
- Visor: Imprimir, Descargar y Cerrar en la misma fila.

### 4.1t Instructivos SGC (`/sistema-gestion-calidad/instructivos`)

- Mismo patrón que Procedimientos, sin listado de áreas.
- Hero con aire; búsqueda a la izquierda y Subir instructivo a la derecha, misma fila.
- PDFs en **2 por fila**: miniatura, código, nombre y acciones en icono.
- Visor: Imprimir, Descargar y Cerrar en la misma fila.

### 4.1u Formatos SGC (`/sistema-gestion-calidad/formatos`)

- Hero con aire.
- Búsqueda a la izquierda y **Subir formato** a la derecha, misma fila.
- Filtros Todos / Word / Excel en la fila de abajo, a lo ancho.
- Capítulos en **carrusel de 1 fila** (flechas y deslizan; el toque selecciona).
- Documentos del capítulo en **2 por fila**.

### 4.1u2 Plantilla AMEF (`/sistema-gestion-calidad/capitulo-6/plantilla/sgc-f-11`)

- Una sola tabla (análisis y plan de acción) con **scroll horizontal**.
- Títulos, columna **#** y **Modo de falla** fijos. Al desplazar, Etapa se oculta y Modo de falla queda pegado junto al número.

### 4.1u3 Plantilla SGC-F-18 (`/sistema-gestion-calidad/capitulo-5/plantilla/sgc-f-18`)

En tablet y teléfono (hasta 1199px). Escritorio no cambia.

- Misma tabla de 8 columnas, con **scroll horizontal**.
- Ancho mínimo por columna para que fechas (`2018-11-20`, `Última reforma`) y la pastilla de vigencia (`Vigente`, `En trámite`, `No vigente`) no se partan ni se recorten.
- El texto largo salta de renglón en los espacios, no a mitad de palabra.

### 4.2 Directorio de empresas (`/mis-empresas`)

- **Cuadrícula de cuadros:** foto grande arriba; debajo nombre y RFC.
- **3 por fila**; **4** si el ancho deja la foto grande (`~540–768px`).
- El toque del cuadro abre la misma acción que ya tenía (repositorio).
- La papelera va en una esquina y **no** dispara el detalle (`stopPropagation`).

### 4.3 Empleados por empresa (`/empleados-empresa`)

- **Cuadrícula de cuadros, 2 por fila** (legibilidad; no usar 3).
- Contenido del cuadro: **nombre** arriba, **CURP** al centro (ancho completo),
  **puesto** abajo.
- Altura según contenido (`aspect-ratio: auto`); sin huecos grandes vacíos.
- Tipografía cómoda (nombre ~0.92rem, CURP ~0.78rem, puesto ~0.82rem como referencia).
- Empresa + búsqueda en la misma fila.
- Toque → panel de detalle abajo (sheet) con fondo difuminado y animación suave.
- CURP completo y edición viven en el detalle; la lista ya muestra un resumen.

### 4.4 Resolutivos (PIPC / atención)

- Tarjetas de **Control** y **Atención** de resolutivos: **completas**, no compactar
  a una sola línea.
- **Resolutivos por atender:** paginación de **5 por página**.
  - Flechas a los lados.
  - Deslizar el dedo izquierda/derecha cambia de página.
  - Al pasar de la última vuelve la primera (y viceversa).
  - Animación corta de deslizamiento.
  - El gesto vertical debe seguir scrolleando la página (`touch-action: pan-y`).

### 4.5 Repositorio empresarial (`/mis-empresas/:id/repositorio`)

**Fila superior (empresa + almacenamiento), simétrica en reposo:**

- Misma fila, mismo ancho y alto al cerrar.
- Izquierda: nombre sobre el logo (compacto).
- Derecha: medidor de almacenamiento + resumen de repositorio.
- Al tocar **empresa**, se abre hacia la **derecha** con el resto de datos
  (nombre/RFC al lado del logo; email, ubicación, contacto **debajo** del logo
  a todo el ancho).
- Al tocar **almacenamiento**, se abre hacia la **izquierda**; lo último que
  aparece es el botón **Subir documento**.
- Mientras la columna de almacenamiento está angosta (empresa abierta), en el
  resumen solo icono + número (sin nombres largos que se partan feo).
- Transiciones largas y suaves (`~0.6–0.7s`, curva tipo `cubic-bezier(0.22, 1, 0.36, 1)`).
  Evitar saltos de `display: none` ↔ `block` en lo que se anima; preferir
  `max-height` / `opacity` / grid-template.

**Barra de archivos (una sola fila):**

Orden: búsqueda → vista cuadrícula/lista → subir → carpeta (y eliminar si aplica).

- Botones de acción: **solo icono**.
- Primer toque: se ensancha y muestra el nombre.
- Segundo toque: ejecuta la acción.
- Cuidado: un `@HostListener('document:click')` no debe cerrar el botón en el
  mismo clic que lo abre (usar flag de un ciclo / `stopPropagation` bien pensado).
- En escritorio el primer clic sigue ejecutando directo.

**Otros del repositorio:**

- **No** mostrar la zona de arrastrar/soltar archivos en móvil.
- Carpetas y archivos: **3 por fila**.
- PC sin cambios.

---

## 5. Gráficas (ApexCharts)

- Si las etiquetas del eje X se enciman: nombres cortos en el eje; valor largo en
  tooltip o en la lista de abajo.
  Ejemplo PIPC: En trámite → Trámite, Vigentes → Vigente, Próximo a vencer → Por vencer.
- En móvil, data labels pueden mostrar solo el conteo.
- Envolver opciones `responsive` de Apex **y** bindear `[responsive]` en el template;
  si no, Apex ignora el breakpoint.
- El `breakpoint` de Apex es por **ancho del chart**, no del viewport.

---

## 6. Scroll táctil (obligatorio)

Problema típico: el dedo empieza sobre una gráfica o una tarjeta y la página no sube/baja.

Solución:

1. `touch-action: pan-y` en `.apexcharts-canvas` y nodos hijos relevantes
   (también en `src/styles.scss` para pantallas futuras).
2. En bloques que forman parte del scroll de la página: **no** dejar
   `overflow-y: auto` ni `overscroll-behavior: contain` en móvil; usar
   `overflow: visible`, `overscroll-behavior: auto`, `height: auto`, `max-height: none`.
3. Listas con `height: 0` + flex en desktop: override en móvil.
4. El gesto **vertical** siempre debe desplazar la página; el horizontal se
   reserva a carruseles / paginación consciente.

---

## 7. Animaciones

| Situación | Comportamiento |
|-----------|----------------|
| Entrada de pantalla / tarjetas | Aparecer + subir unos px; escalonado si hay varias (`animation-delay` por `nth-child`) |
| Paginación / swipe | Deslizar corto (~0.4s) en la dirección del movimiento |
| Sheet / modal de detalle | Subir desde abajo o fade + blur del fondo |
| Botones icono → nombre | Ensanchar con transición continua (`max-width` / `padding` / `opacity`), ~0.6s |
| Paneles empresa / almacenamiento | Abrir L→R o R→L con transición suave; evitar saltos de layout |

Respetar `prefers-reduced-motion` cuando ya exista en el componente.

---

## 8. Modales y paneles de detalle

- Fondo: `rgba(…, 0.42–0.55)` + `backdrop-filter: blur(6–7px)`.
- Cierre: botón X, toque en el backdrop, Escape si aplica.
- `document.body.style.overflow = 'hidden'` al abrir; limpiar al cerrar y en `ngOnDestroy`.
- En móvil preferir **sheet inferior** fijo si el detalle es un formulario corto
  (empleados); o **dialog centrado** (cursos).

---

## 9. Qué no hacer

- No compactar a una línea las tarjetas que el usuario pidió **completas**
  (resolutivos de control / atención).
- No cambiar el layout de escritorio “de paso”.
- No meter `overflow-y: auto` anidado en el scroll principal del móvil.
- No usar 3 columnas de empleados si la tipografía queda chica; priorizar lectura.
- No dejar zonas de drag & drop de archivos en móvil.
- No reiniciar el backend ni matar el `npm start` del usuario.

---

## 10. Pantallas ya adaptadas (referencia)

| Ruta / apartado | Notas clave |
|-----------------|-------------|
| `/dashboard` Panel de control | Filtros en fila; KPIs 3 en fila; cursos hoy + próximos lado a lado; modal de curso |
| Dashboard → PIPC activos (embebido) | Gráfica con labels cortos; KPIs 3; leyenda 3; resolutivos paginados de 5; scroll pan-y |
| `/mis-empresas` | Cuadrícula foto + nombre + RFC |
| `/mis-empresas/:id/repositorio` | Ficha + almacenamiento simétricos; barra de iconos; sin dropzone; grid 3 |
| `/empleados-empresa` | Filtros en fila; cuadros 2/fila; sheet de detalle |
| `/` Catálogo / Categorías de cursos | 2 categorías por fila; tipografía legible; Gestionar a lo ancho; búsqueda 2/fila |
| Cursos por categoría (`cursosbiz`) | 2 cursos por fila; búsqueda a lo ancho; tipografía legible |
| Información General (docs del curso) | Hero con aire; botones a lo ancho; docs 3/fila (2 si angosto) |
| `/control-capacitacion` | Hero; botones en misma fila; filtros 2×2; tabla con scroll lateral |
| `/asig-curso` | Form compacto: horario 1 fila; empresa/instructor juntos; botones misma fila |
| `/curso-activos` | Filtros 2 en fila; tabla con scroll lateral; fecha sin romper línea |
| `/gestionar-curso` | Acciones rápidas 2 cols; detalles 2/fila; hero + Volver compacto |
| `/historial-cursos` | Sin Compacto; instrucciones debajo; drill-in empresa→cursos |
| `/historial-constancias-dc3` | Hero; leyenda 2/fila; Buscar+Limpiar misma fila; tabla scroll |
| `/proteccion-civil/asignacion-pipc` | Tabs 3/fila; formatos/dirs grid 3 (2 si angosto) |
| `/proteccion-civil` (PIPC Activos) | KPIs 3+2 centrados; estatus 2×2; empresas grid 2; atención |
| `/proteccion-civil/control-resolutivos` | Acciones 1 fila; filtros 2×2; tabla sticky header+Item/Empresa |
| `/proteccion-civil/historial-pc` | Sin Compacto; filtros 2×2; drill-in empresa→trámites |
| `/expedientes-medicos` | Hero; empresas 2/fila; form 3 o 2 campos/fila; menú 2 acciones; historial 2×2 |
| `/audiometria` | Hero; empresas 2/fila; form 2/3 campos; menú 2 acciones; historial scroll |
| `/estadisticas-medicas` | Hero; KPIs 3+2; controles 1 fila; charts 2/fila; leyendas wrap; pan-y |
| `/sistema-gestion-calidad` | Hero; KPIs 3+2; leyenda 2/fila; caps carrusel; docs 2×3; donuts centrados |
| `/sistema-gestion-calidad/procedimientos` | Hero; subir + búsqueda juntos; áreas 2/fila; PDFs 2/fila; visor 1 fila |
| `/sistema-gestion-calidad/instructivos` | Hero; subir + búsqueda juntos; PDFs 2/fila; visor 1 fila |
| `/sistema-gestion-calidad/formatos` | Hero; búsqueda + Subir misma fila; filtros abajo; caps carrusel; docs 2/fila |

---

## 11. Mantenimiento de esta guía

Cada vez que el usuario pida o acepte un patrón nuevo:

1. Agregarlo aquí en la sección que corresponda (o crear una).
2. Reflejarlo en una viñeta corta en `.cursor/rules/responsive-mobile.mdc`.
3. Si aplica a “todas las pantallas futuras”, redactarlo como regla general, no solo como caso de una ruta.

Última actualización: Instructivos del SGC en móvil.
