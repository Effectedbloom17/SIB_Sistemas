@echo off
cd /d "%~dp0.."
echo == stage pendientes firmas ==
git add ^
  backend/sgcFirmasRoutes.js ^
  backend/sgcFirmasService.js ^
  backend/scripts/sgc-firmas-fase1.test.js ^
  backend/pcResolutivosAvisosService.js ^
  backend/pcResolutivosService.js ^
  backend/driveService.js ^
  backend/notificacionesOperativasService.js ^
  backend/server.js ^
  package.json ^
  _copy_biznaguita.js ^
  scripts/copy-biznaguita.bat ^
  scripts/copy-biznaguita.cmd ^
  scripts/copy-biznaguita.js ^
  scripts/sync-commit-push-firmas.cmd ^
  scripts/sync-commit-push-firmas.ps1 ^
  scripts/finish-commit-push-firmas.cmd ^
  scripts/finish-commit-push-firmas-rest.cmd ^
  src/app/components/navbar/navbar.component.ts ^
  src/app/components/sidebar/sidebar.component.html ^
  src/app/components/sidebar/sidebar.component.ts ^
  src/app/layouts/admin-layout/admin-layout.component.html ^
  src/app/layouts/admin-layout/admin-layout.component.scss ^
  src/app/layouts/admin-layout/admin-layout.component.ts ^
  src/app/pages/sistema-gestion-calidad/sgc-firma-crypto.ts ^
  src/app/pages/sistema-gestion-calidad/sgc-firma-device-trust.ts ^
  src/app/pages/sistema-gestion-calidad/sgc-firmas.component.html ^
  src/app/pages/sistema-gestion-calidad/sgc-firmas.component.scss ^
  src/app/pages/sistema-gestion-calidad/sgc-firmas.component.ts ^
  src/app/pages/sistema-gestion-calidad/sgc-pedir-firma.component.ts ^
  src/app/pages/sistema-gestion-calidad/sgc-plantilla-preview.component.html ^
  src/app/pages/sistema-gestion-calidad/sgc-plantilla-preview.component.scss ^
  src/app/pages/sistema-gestion-calidad/sistema-gestion-calidad.module.ts ^
  src/app/services/backend.services.ts ^
  src/assets/img/biznaguita/ ^
  src/assets/img/mascota-biznaga.png

git status --short
echo == bump patch version via powershell inline ==
powershell -NoProfile -Command "(Get-Content package.json -Raw) -replace '\"version\": \"3\.383\.0\"','\"version\": \"3.383.1\"' | Set-Content package.json -NoNewline"
git add package.json
git status --short
echo == commit ==
git commit -m "feat: completar firmas SGC (servicios, UI y crypto)"
if errorlevel 1 (
  echo Nada que commitear o fallo.
  exit /b 1
)
echo == push ==
git push -u origin HEAD
git status -sb
echo Listo.
