# Auditoria de Ciberseguridad

Script principal: `scripts/security-audit.js`

## Comandos

- Auditoria completa (incluye dependencias):
  - `npm run security:audit`
- Auditoria rapida (sin `npm audit`):
  - `npm run security:audit:quick`
  - Nota: esta variante usa `--fail-on none` para no bloquear por hallazgos aceptados temporalmente.

## Que valida

Nota: por configuracion del proyecto, los archivos `.md` se excluyen de deteccion de credenciales para evitar ruido en documentacion interna.

- SQL Injection:
  - SQL construido con template literals interpolados.
  - SQL por concatenacion de strings.
  - `query/execute` desde SQL dinamico.
- Ejecucion de codigo/comandos:
  - `eval`, `new Function`, `child_process` dinamico.
- Secrets y credenciales:
  - Tokens, claves y secretos hardcodeados.
  - Archivos sensibles versionados.
- Hardening HTTP/JWT:
  - Configuracion de CORS riesgosa.
  - Falta de restricciones de algoritmo en JWT.
  - Tokens enviados por query string.
  - Falta de hardening recomendado (`helmet`, `x-powered-by`).
- Path traversal:
  - Uso de `req.params/query/body` en paths de archivos.
- Dependencias vulnerables:
  - `npm audit --json` para root y backend.

## Salida

Se generan reportes en:

- `reports/security-audit/security-audit-report.json`
- `reports/security-audit/security-audit-report.md`

## Exit code

- `0`: sin hallazgos por encima del umbral configurado.
- `2`: hay hallazgos en la severidad objetivo o superior.
- `1`: error de ejecucion.

Por defecto el umbral es `high`.

## Opciones utiles

- `--fail-on none|info|low|medium|high|critical`
- `--skip-deps`
- `--max-file-size-kb 2048`
- `--max-files 12000`
- `--format json|md|both`
