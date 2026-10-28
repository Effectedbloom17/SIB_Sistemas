# Sync + commit + push (firmas SGC). Ejecutar en PowerShell desde la raíz del repo:
#   powershell -NoProfile -ExecutionPolicy Bypass -File scripts/sync-commit-push-firmas.ps1

$ErrorActionPreference = 'Stop'
Set-Location (Join-Path $PSScriptRoot '..')

Write-Host '== fetch ==' -ForegroundColor Cyan
git fetch origin
git status -sb

$behind = git rev-list --count HEAD..origin/desarrollo 2>$null
$ahead = git rev-list --count origin/desarrollo..HEAD 2>$null
Write-Host "behind=$behind ahead=$ahead"

if ([int]$behind -gt 0) {
  Write-Host '== stash local (si hay cambios) ==' -ForegroundColor Cyan
  git stash push -u -m 'wip-antes-sync-firmas' -- `
    backend/driveService.js `
    backend/notificacionesOperativasService.js `
    backend/server.js `
    backend/sgcFirmasRoutes.js `
    backend/sgcFirmasService.js `
    backend/scripts/sgc-firmas-fase1.test.js `
    package.json `
    src/app/components/navbar/navbar.component.ts `
    src/app/components/sidebar/sidebar.component.html `
    src/app/components/sidebar/sidebar.component.ts `
    src/app/layouts/admin-layout/admin-layout.component.html `
    src/app/layouts/admin-layout/admin-layout.component.ts `
    src/app/pages/sistema-gestion-calidad `
    src/app/services/backend.services.ts 2>$null

  Write-Host '== pull ==' -ForegroundColor Cyan
  git pull --no-rebase origin desarrollo

  Write-Host '== stash pop ==' -ForegroundColor Cyan
  git stash pop 'stash@{0}'
  if ($LASTEXITCODE -ne 0) {
    Write-Host 'Hubo conflicto al restaurar. Resuélvelo y vuelve a correr el script (o termina a mano).' -ForegroundColor Yellow
    exit 1
  }
}

# Versión: bump minor si no hay conflicto; si package.json tiene marcadores, avisar
$pkg = Get-Content package.json -Raw
if ($pkg -match '<<<<<<<') {
  Write-Host 'Conflicto en package.json. Resuélvelo y reintenta.' -ForegroundColor Red
  exit 1
}

Write-Host '== commit ==' -ForegroundColor Cyan
git add `
  backend/driveService.js `
  backend/notificacionesOperativasService.js `
  backend/server.js `
  backend/sgcFirmasRoutes.js `
  backend/sgcFirmasService.js `
  backend/scripts/sgc-firmas-fase1.test.js `
  package.json `
  src/app/components/navbar/navbar.component.ts `
  src/app/components/sidebar/sidebar.component.html `
  src/app/components/sidebar/sidebar.component.ts `
  src/app/layouts/admin-layout/admin-layout.component.html `
  src/app/layouts/admin-layout/admin-layout.component.ts `
  src/app/pages/sistema-gestion-calidad/sgc-firma-crypto.ts `
  src/app/pages/sistema-gestion-calidad/sgc-firmas.component.html `
  src/app/pages/sistema-gestion-calidad/sgc-firmas.component.scss `
  src/app/pages/sistema-gestion-calidad/sgc-firmas.component.ts `
  src/app/pages/sistema-gestion-calidad/sgc-pedir-firma.component.ts `
  src/app/pages/sistema-gestion-calidad/sgc-plantilla-preview.component.html `
  src/app/pages/sistema-gestion-calidad/sgc-plantilla-preview.component.scss `
  src/app/pages/sistema-gestion-calidad/sistema-gestion-calidad.module.ts `
  src/app/services/backend.services.ts

git status --short

git commit -m "feat: firmas electronicas SGC (pedir firma, crypto y notificaciones)"
if ($LASTEXITCODE -ne 0) {
  Write-Host 'Commit fallo o no habia nada que commitear.' -ForegroundColor Yellow
  exit $LASTEXITCODE
}

Write-Host '== push ==' -ForegroundColor Cyan
git push -u origin HEAD
git status -sb
Write-Host 'Listo.' -ForegroundColor Green
