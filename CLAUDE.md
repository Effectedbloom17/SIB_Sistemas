# Instrucciones del Proyecto BIZNAGA R&T

## Versionado Automatico

Al finalizar cada sesion de trabajo donde se hagan cambios al codigo, actualizar la version en `package.json` campo `"version"` siguiendo semver:

- **patch** (1.5.0 → 1.5.1): correcciones de bugs, ajustes de estilo, fixes menores
- **minor** (1.5.1 → 1.6.0): funcionalidad nueva, pantallas nuevas, endpoints nuevos
- **major** (1.6.0 → 2.0.0): cambios que rompen compatibilidad, migraciones de BD, reestructuraciones grandes

La version se muestra automaticamente en el sidebar del frontend via `src/app/components/sidebar/sidebar.component.ts` (importa `package.json`). No requiere cambios adicionales.

## Novedades y tickets

- El icono de engranaje (**Funcionamiento del sistema**) está **siempre activo**.
- Cualquier usuario envía **tickets** (área + tipo falla/sugerencia + descripción + evidencias opcionales) → tabla `tickets` (BD `biznaga`).
- El icono de **Estatus de Tickets** solo se muestra si el usuario ya tiene tickets.
- Se acumulan en el **ciclo actual** (`publicado_version IS NULL`) y notifican a `root`.
- Inbox: **Comunicación → Tickets** (solo `root`).
- Con `deploy.ps1` exitoso:
  1. Se preparan los pendientes en el historial de novedades (archivo).
  2. Al final sin error, se marcan como publicados y se borran solo las notificaciones de aportaciones (`/tickets`).
  3. La lista del ciclo queda vacía para nuevas modificaciones.
- Scripts: `backend/scripts/ticketsCiclo.js preparar|finalizar [version]`.
