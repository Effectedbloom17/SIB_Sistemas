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
  La búsqueda sigue en la barra y crece solo hasta donde caben los iconos.

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

### 4.1u1 Normativas SGC (`/sistema-gestion-calidad/normativas`)

- Hero con aire; búsqueda a lo ancho.
- Grupos en **una fila que se desliza** (el toque selecciona). La lista no se colapsa a una raya.
- Normas del grupo en **2 por fila**, con la paginación debajo.

### 4.1u4 Solicitud de Documentos (`/sistema-gestion-calidad/solicitud-documentos`)

- Hero con aire; el título largo cabe sin chocar con la tarjeta.
- KPIs en **2 por fila** (4 tarjetas).
- Búsqueda a lo ancho, lupa completa.
- Filtros Todos / Por autorizar / En gestión / Completadas en **2 por fila**.
- Cada solicitud muestra el título en 2 líneas; al abrirla, los botones de la gestión van en la misma fila.

### 4.1u5 Catálogo de Normativas (`/seguridad/normativas`)

- Hero con aire.
- Tres indicadores en **una fila**.
- Búsqueda a la izquierda e **Importar Excel** a la derecha, misma fila (sin hueco).
- Grupos NOM en **3 por fila**.
- Tarjetas de normativa en **2 por fila**: portada baja, clave y título.

### 4.1u6 Detalle de normativa (`/seguridad/normativas/:id`)

Cada norma abre la misma ficha. En teléfono:

- Hero con aire; el título largo queda debajo de la barra.
- Tres indicadores en **una fila**. **Editar ficha** y **Eliminar** en la misma fila.
- Búsqueda a la izquierda y el conteo de cláusulas a la derecha.
- Cada cláusula (pueden ser muchas) lleva el número y el punto en una franja arriba, en una sola línea, y el lápiz en esa misma franja. El texto usa todo el ancho. La lista se desplaza con la página.

### 4.1u7 Asignación de Normativas (`/seguridad/asignacion`)

- Hero con aire. Los tres pasos quedan en una fila.
- Empresa y su búsqueda en la misma fila. La búsqueda de normas va a lo ancho.
- Grupos en **3 por fila**, sin cortarse.
- Normas en **2 por fila**. La lista y Responsables se desplazan con la página.
- Anterior, el conteo y Continuar quedan en la misma fila. En Resumen, las tarjetas también van 2 por fila.

### 4.1u8 Gestión de Normativas (`/seguridad/gestion`)

- Hero con aire.
- El título de Empresas queda pegado a los indicadores: sin el hueco blanco.
- Tres indicadores en **una fila**. **Asignar** a lo ancho debajo.
- Búsqueda de empresa a lo ancho. La pista de ayuda se lee completa, en varias líneas.
- Cada empresa sigue en su propia tarjeta (logo, avance y conteos). Al abrirla, las normas van en **2 por fila**, cada una dentro de su tarjeta.
- En el panel de la empresa, el eje de desempeño usa el número corto (`001`, `036-1`); el código completo sale al tocar el punto. Los grupos van en **3 por fila**.

### 4.1u9 Residentes (`/recursos-humanos/residentes`)

- Hero con aire.
- Búsqueda a la izquierda y el año a la derecha, misma fila.
- **Hoja Excel** y **Nuevo residente** en la misma fila.
- Credenciales y residencia terminada en **2 por fila**: foto, nombre y vigencia dentro de la tarjeta.
- Al abrir la ficha: foto y nombre en la misma franja, con matrícula, ingreso, NSS y vigencia debajo. Escuela, carrera, correos y dirección a lo ancho. Edad con estancia, supervisión con fecha, y teléfono del tutor con NSS, en parejas. Editar y Eliminar en la misma fila.

### 4.1u10 Registros de Recursos Humanos (`/recursos-humanos/registros`)

- Hero con aire.
- Drive, Nueva carpeta y Subir en una fila de iconos.
- Filtros del repositorio en **2 por fila** (Todo, PDF, Documentos, Imágenes).
- Sin la zona grande de arrastrar: se sube con el botón de arriba.
- Búsqueda a la izquierda; conteo, vista y actualizar a la derecha.
- Carpetas y archivos en **2 por fila**.

### 4.1u11 Ambiental (`/ambiental`)

- Hero con aire. El título del formato queda pegado a la búsqueda, sin el hueco blanco.
- Búsqueda de empresa a lo ancho, con el filtro y el porcentaje completado en la misma zona.
- En la ficha de la empresa: Sync a lo ancho; **Guardar información** y **Abrir editor** en la misma fila.
- Búsqueda de trámites a lo ancho. Estatus a lo ancho. Responsable y consultor en **2 por fila**.
- La tabla de trámites se desplaza de lado. **Agregar trámite** queda visible a la izquierda.

### 4.1u12 Control de avance de proyectos (`/control-proyectos`)

- Hero con aire.
- Vistas en **2 por fila**: Dashboard, Gestión, Solicitudes, Tablero, Cronograma, Actividades, Eliminados y Registrar proyecto.
- Indicadores en **2 por fila** (finalizadas, actualizadas, proyectos, avance).
- Resumen y **Actualizar** en la misma fila. El conteo de proyectos queda a la derecha del título.
- La lista de proyectos activos va a lo ancho. Debajo, la distribución por estatus y el resto de gráficos, también a lo ancho, con la dona centrada.
- La nota del final se lee como un párrafo. **Registrar proyecto** sigue en la frase, sin partirla en columnas.

### 4.1u13 Control de Oficios (`/control-oficios`)

- Hero con aire.
- Código, cantidad de registros y la fecha de sincronización se leen completos.
- **Guardar información** a lo ancho. **Abrir editor integrado** y **Nuevo** en la misma fila.
- La lista de oficios va a lo ancho y se desplaza con la página.
- La vista previa queda debajo: el título del oficio a lo ancho y Imprimir, Editar y Eliminar en la misma fila.
- El documento ocupa una pantalla, sin el hueco negro debajo.

### 4.1u14 Proyectos de señalización (`/diseno-innovacion`)

- Hero con aire.
- La búsqueda va a lo ancho. El filtro de clasificación también, con el nombre completo.
- Historial, cotización y registro quedan junto al cambio de vista, en la misma fila.
- Las categorías se leen a lo ancho. En cuadrícula, las piezas van de **2 en 2** cuando hay más de una; en lista, una por fila.
- En el historial, Descargar Excel y Nueva cotización van en la misma fila. La tabla de la cotización se desplaza de lado.

### 4.1u15 Repositorio de señalización (`/diseno-innovacion/repositorio`)

- Hero con aire.
- Todo, PDF, Documentos e Imágenes en **2 por fila**. Subir documento a lo ancho.
- Búsqueda a la izquierda y Subir a la derecha. La vista y Nueva carpeta en la fila de abajo.
- Sin la zona grande de arrastrar.
- Carpetas y archivos en **2 por fila**. El nombre largo se corta en dos líneas.
- En lista, la tabla se desplaza de lado.

### 4.1u16 Inventario de señalizaciones (`/diseno-innovacion/inventario`)

- Hero con aire.
- **Agregar** e **Importar Excel** en la misma fila. **Gestionar inventario** a lo ancho, debajo.
- Indicadores en **2 por fila**. Los materiales siguen en pastillas que saltan de renglón.
- La búsqueda y el filtro de material van a lo ancho, sin salirse de la tarjeta.
- Las piezas siguen de **2 en 2**. El tipo (Advertencia, Personalizado, Condición segura) no se parte a la mitad; el tamaño queda en la misma zona. Cantidad y Editar siguen juntos.

### 4.1u17 Programa de infraestructura (`/mantenimiento/programa-infraestructura`)

- Hero con aire.
- Los seis indicadores van de **3 en 3**: cobertura, programados, activos, internos, externos y el mes con más carga.
- Periodo y año siguen en la misma fila.
- **Guardar información** y **Exportar PDF** en la misma fila. **Abrir editor integrado** a lo ancho, en el programa y en la bitácora.
- La tabla del programa se desplaza de lado. El nombre de la infraestructura se queda fijo y el texto se lee completo, sin que los meses lo tapen.
- En la bitácora, al desplazar, la fila de títulos y la columna de números se quedan fijas.
- El archivero mantiene la búsqueda a lo ancho y Nuevo reporte con Desde Forms en la misma fila. Los reportes van de **2 en 2**: de tres el folio y el estado ya no caben.

### 4.1u18 Solicitud de mantenimiento (`/mantenimiento/solicitud`)

- Hero con aire.
- Código, revisión y fecha van de **3 en 3**.
- **Abrir formulario** y **Copiar enlace** en la misma fila. El enlace de Forms se lee completo, dentro de la tarjeta.
- **Sincronizar a bitácora** y **Actualizar** en la misma fila.
- Los tres indicadores (total, este mes, tipos) van en **una fila**.
- Tipo de infraestructura y ubicación muestran el nombre completo, con la barra en su color original y la cantidad al lado.
- Alta, media y baja van de **3 en 3**. La dona sigue centrada.
- Últimas respuestas se desplaza de lado. El texto largo baja de renglón dentro de su columna, sin estirar la tabla.

### 4.1u19 Calendario de cursos (`/calendario`)

- Hero con aire.
- El correo del calendario cabe en su pastilla, aunque sea largo.
- En el teléfono el calendario se abre como agenda: cada curso se lee con su nombre completo. En escritorio sigue el mes.

### 4.1u20 Opiniones y sugerencias (`/quejas-sugerencias`)

- Hero con aire.
- Los cuatro indicadores van de **2 en 2**: en vista, no realizados, en desarrollo y realizados.
- Los filtros van de **2 en 2**: Todos, No realizados, En desarrollo y Realizados.
- La búsqueda, cuando hay registros, queda a lo ancho. Cada opinión sigue en su propia fila.

### 4.1u21 Centro de correo (`/correo`)

- Hero con aire.
- **Redactar** queda a lo ancho.
- Las carpetas van de **2 en 2**: Entrada, Borradores, Enviados, SPAM, Papelera y Archivo. De tres, el nombre y «0 mensajes» ya no caben.
- En el teléfono quedan cerradas. Una flecha, junto a la carpeta actual, las abre hacia abajo. Al elegir una, el menú se cierra. La bandeja sube y baja con ese menú, sin hueco fijo debajo.
- El título de la carpeta y **Actualizar** siguen en la misma fila. La búsqueda va a lo ancho.
- Cada correo, cuando hay, baja de renglón dentro de la fila. La lista se desplaza con la página.

### 4.1u22 Tickets (`/tickets`)

- Hero con aire.
- Los seis indicadores van de **3 en 3**. El nombre baja de renglón si hace falta, sin recortarse.
- En Evolución mensual, No realizados, En desarrollo y Realizados quedan de **3 en 3**, con el nombre completo (baja de renglón si hace falta).
- La búsqueda va a lo ancho, sin inflarse. Los filtros se acomodan en la fila y el mes queda debajo, a lo ancho.
- Cada columna del tablero baja con la página. Dentro, los tickets van de **2 en 2** y solo muestran el nombre. Al tocarlo se abre la ficha con el fondo borroso.

### 4.1u23 Diagramas (`/diagramas`)

- Hero con aire. La búsqueda va a lo ancho.
- Las tarjetas van de **2 en 2**, con el nombre completo y el botón **Ver**.
- En el teléfono no se crea, no se renombra, no se elimina y no se edita. Al abrir, diagrams.net entra en visor y no guarda cambios.
- En la computadora sigue el editor, con Nuevo diagrama, Abrir y Eliminar.

### 4.1u24 Gestión de usuarios (`/gestion-usuarios`)

- Hero con aire.
- Buscar y **Nuevo Usuario** siguen en la misma fila.
- Las dos pestañas caben juntas. «Administradores e Instructores» baja de renglón; «Empresas» queda al lado.
- La tabla es la misma, con scroll lateral. Usuario, correo, «Ver roles» y Acciones quedan en una línea. El nombre baja de renglón dentro de su columna.

### 4.1u25 Panel de control (`/dashboard`)

- Los seis marcadores van de **3 en 3**. El nombre baja de renglón si hace falta, sin recortarse.

### 4.1u2 Plantilla AMEF y ### 4.1u3 SGC-F-18

El detalle de cada plantilla vive en el apartado **12. Formatos del SGC**.

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
| `/sistema-gestion-calidad/normativas` | Hero; búsqueda a lo ancho; grupos en fila con desliz; normas 2/fila |
| `/sistema-gestion-calidad/solicitud-documentos` | Hero; KPIs 2/fila; filtros 2/fila; título de solicitud en 2 líneas |
| `/seguridad/normativas` | Hero; KPIs 3/fila; búsqueda + Importar misma fila; grupos 3/fila; tarjetas 2/fila |
| `/seguridad/normativas/:id` | Hero; KPIs 3/fila; Editar+Eliminar misma fila; cláusula con punto arriba y texto a lo ancho |
| `/seguridad/asignacion` | Hero; pasos 1 fila; grupos 3/fila; normas 2/fila; Anterior+Continuar misma fila |
| `/seguridad/gestion` | Hero; KPIs 3/fila; Asignar a lo ancho; empresas 1/fila; panel con eje corto y normas 2/fila |
| `/recursos-humanos/residentes` | Hero; búsqueda + año; Excel + Nuevo; credenciales 2/fila; ficha con campos cortos en pareja |
| `/recursos-humanos/registros` | Hero; filtros 2/fila; sin zona de arrastre; búsqueda + vista misma fila; archivos 2/fila |
| `/ambiental` | Hero; sin hueco bajo el título; búsquedas a lo ancho; tabla con scroll lateral |
| `/control-proyectos` | Vistas 2/fila; KPIs 2/fila; gráficos debajo de la lista, a lo ancho |
| `/control-oficios` | Guardar a lo ancho; editor y Nuevo en una fila; vista previa debajo, a lo ancho |
| `/diseno-innovacion` | Búsqueda y clasificación a lo ancho; piezas 2/fila; historial con tabla lateral |
| `/diseno-innovacion/repositorio` | Filtros 2/fila; sin zona de arrastre; carpetas y archivos 2/fila |
| `/diseno-innovacion/inventario` | Agregar + Excel; Gestionar a lo ancho; búsqueda dentro de la tarjeta; piezas 2/fila |
| `/mantenimiento/programa-infraestructura` | KPIs 3/fila; nombre fijo en el programa; títulos y números fijos en la bitácora; reportes 2/fila |
| `/mantenimiento/solicitud` | Código 3/fila; KPIs 3/fila; barras con su color; prioridad 3/fila; tabla con texto que baja de renglón |
| `/calendario` | Hero; agenda en el teléfono con el nombre del curso completo; el mes se queda en escritorio |
| `/quejas-sugerencias` | KPIs 2/fila; filtros 2/fila; búsqueda a lo ancho |
| `/correo` | Redactar a lo ancho; carpetas 2/fila dentro de un desplegable; búsqueda a lo ancho |
| `/tickets` | KPIs 3/fila; tickets 2/fila; ficha con fondo borroso |
| `/diagramas` | Búsqueda a lo ancho; tarjetas 2/fila; solo lectura, visor sin edición |
| `/gestion-usuarios` | Pestañas juntas; tabla con scroll; usuario y correo en una línea |
| `/dashboard` | Marcadores 3/fila |
| Plantillas SGC | Apartado 12. Cada formato suma solo lo suyo |

---

## 11. Mantenimiento de esta guía

Cada vez que el usuario pida o acepte un patrón nuevo:

1. Agregarlo aquí en la sección que corresponda (o crear una).
2. Reflejarlo en una viñeta corta en `.cursor/rules/responsive-mobile.mdc`.
3. Si aplica a “todas las pantallas futuras”, redactarlo como regla general, no solo como caso de una ruta.
4. Si es una plantilla de formato del SGC, anotarla en el apartado **12**, no en el listado general.

Última actualización: el resto de los formatos del capítulo 7 en el teléfono.

---

## 12. Formatos del SGC

Apartado vivo de las plantillas (`/sistema-gestion-calidad/capitulo-…/plantilla/…`).

Cada formato hereda lo que ya vale en el resto de la guía. Escritorio no se toca. En el teléfono:

- Hero con aire.
- Encabezado del formato, en todos: arriba el fondo es blanco. El logo queda a la izquierda, siempre del mismo tamaño, y frente a él Código, Revisión y Fecha de rev. en dos columnas alineadas, con las palabras completas. Debajo, el nombre va sobre el verde del SGC, con el texto en blanco y el mismo tamaño.
- Botones relacionados en la misma fila.
- Hasta 3 indicadores por fila cuando el texto cabe.
- Tabla densa: la misma tabla, con scroll lateral. Cada columna tiene ancho real. Lo corto (código, fecha, versión, área) queda en una línea. El texto largo baja de renglón dentro de su columna, en los espacios, sin partir palabras y sin irse al infinito.
- Nada fuera de la celda. El toque sobre la tabla también deja bajar la página (`touch-action: pan-x pan-y`).
- Botones compactos que en escritorio muestran el nombre al pasar el cursor: en el teléfono el primer toque despliega el nombre, con una animación suave, y el segundo toque hace la acción. Un toque fuera lo cierra. En escritorio sigue siendo al pasar el cursor.

Lo que cambie en un formato concreto se anota debajo, y solo ahí. Las notas nuevas se suman cuando salgan.

### 12.1 SGC-F-11 AMEF (`/sistema-gestion-calidad/capitulo-6/plantilla/sgc-f-11`)

- Una sola tabla (análisis y plan de acción) con scroll horizontal.
- Títulos, columna **#** y **Modo de falla** fijos. Al desplazar, Etapa se oculta y Modo de falla queda pegado junto al número.

### 12.2 SGC-F-18 (`/sistema-gestion-calidad/capitulo-5/plantilla/sgc-f-18`)

En tablet y teléfono (hasta 1199px).

- Misma tabla de 8 columnas, con scroll horizontal.
- Ancho mínimo por columna para que fechas (`2018-11-20`, `Última reforma`) y la pastilla de vigencia (`Vigente`, `En trámite`, `No vigente`) no se partan ni se recorten.
- El texto largo salta de renglón en los espacios, no a mitad de palabra.

### 12.3 SGC-F-01 Lista maestra (`/sistema-gestion-calidad/capitulo-7/plantilla/sgc-f-01`)

- La tabla es la misma, con scroll lateral: Área, Tipo, Código, Versión, Fecha rev., Nombre y Responsable.
- Nombre y Responsable tienen ancho. Si se quedan en cero, el texto se parte letra por letra y cada fila ocupa casi toda la pantalla.
- La fila mide el texto. El nombre baja de renglón dentro de su columna.
- La fila de títulos (Área, Tipo, Código, Versión, Fecha rev., Nombre, Responsable) se queda fija al desplazar la lista.
- El hero deja aire arriba, debajo de la barra, para que el icono y «Vista en sistema» no queden pegados.
- El encabezado sigue la regla común: franja blanca con logo y datos, y el nombre sobre el verde del SGC.
- Cada sección (Procedimientos, Formatos, …) lleva una flecha. Empieza contraída; al tocarla la tabla se abre con una animación suave y al tocarla de nuevo se cierra igual. Si hay búsqueda o filtro, las secciones con resultados se abren.

### 12.4 SGC-F-02 Solicitud de cambios (`/sistema-gestion-calidad/capitulo-7/plantilla/sgc-f-02`)

- El hero deja aire arriba, debajo de la barra.
- El encabezado sigue la regla común: franja blanca con logo y datos, y el nombre sobre el verde del SGC.
- Guardar información y Abrir editor integrado van en la misma fila. El icono y «Solicitudes por persona» van juntos. La búsqueda y Nueva solicitud van en la misma fila.
- La descripción larga se oculta. Fecha y puesto van juntos; nombre y área, a lo ancho.
- La tabla de documentos se desplaza de lado y la fila de títulos se queda fija.
- Sin zona de arrastre: Subir archivos es un botón corto, claro, no a lo ancho. Los archivos van de 2 en 2, con el nombre en dos líneas y las acciones en icono.

### 12.5 SGC-F-03 Lista de distribución (`/sistema-gestion-calidad/capitulo-7/plantilla/sgc-f-03`)

- El hero deja aire arriba, debajo de la barra.
- El encabezado sigue la regla común: franja blanca con logo y datos, y el nombre sobre el verde del SGC.
- Guardar información y Abrir editor integrado van en la misma fila. El botón de PDF sigue compacto: el primer toque muestra «Descargar PDF» y el segundo descarga.
- La búsqueda y el conteo de registros van en la misma fila.
- La tabla se desplaza de lado. Las dos filas de títulos se quedan fijas. Cada columna tiene ancho real; el nombre baja de renglón dentro de la suya.

### 12.6 AF-F-02 Contrato (`/sistema-gestion-calidad/capitulo-7/plantilla/af-f-02`)

- El hero deja aire arriba, debajo de la barra.
- El encabezado sigue la regla común: franja blanca con logo y datos, y el nombre sobre el verde del SGC.
- En el archivero, la búsqueda y Nuevo contrato van en la misma fila. Los contratos van de 2 en 2.
- En el contrato: Volver al archivero a lo ancho; Guardar y Descargar PDF en la misma fila. Empresa a lo ancho; fecha de revisión y revisión juntas. Los textos largos a lo ancho y los datos cortos de 2 en 2.

### 12.7 Resto del capítulo 7

ATH-F-02, ATH-F-03, ATH-F-06, ATH-F-07, ATH-F-08, ATH-F-11, ATH-F-13, ATH-F-14, SGC-F-17, SGC-F-19, SGC-F-20 y SGC-F-27 de medición. SGC-F-01, SGC-F-02, SGC-F-03 y AF-F-02 ya tienen su nota.

- El hero deja aire arriba. El encabezado sigue la regla común.
- Guardar y Descargar van en la misma fila.
- En los archiveros, la búsqueda y el botón de alta van juntos. Si también hay Importar, la búsqueda queda arriba y los dos botones en la fila de abajo. Las tarjetas van de 2 en 2, también en evaluaciones (ATH-F-11) y en verificaciones (SGC-F-27). La descripción larga se oculta. En SGC-F-27 el título queda arriba y la búsqueda con «Nueva verificación» en la fila de abajo. El nombre del instrumento baja de renglón dentro de la tarjeta.
- Las tablas se desplazan de lado, con la fila de títulos fija y ancho real por columna. El saldo de vacaciones (ATH-F-14) hace lo mismo dentro de su propia cuadrícula.
