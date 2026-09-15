# Copia las bases del MariaDB de la LAN (u otra fuente) al contenedor local biznaga_mariadb.
# Uso:
#   npm run db:sync
#   powershell -File scripts/sync-db-lan-a-local.ps1

param(
    [string]$SourceHost = '',
    [int]$SourcePort = 0,
    [string]$SourceUser = '',
    [string]$SourcePass = '',
    [int]$LocalPort = 0
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

function Read-EnvValue([string]$Name) {
    $envFile = Join-Path $root 'backend\.env'
    if (-not (Test-Path $envFile)) { return $null }
    $line = Get-Content $envFile | Where-Object { $_ -match "^\s*$Name\s*=" } | Select-Object -First 1
    if (-not $line) { return $null }
    return ($line -split '=', 2)[1].Trim()
}

if (-not $SourceHost) { $SourceHost = Read-EnvValue 'DB_HOST_LAN' }
if (-not $SourceHost) { $SourceHost = '192.168.1.140' }
if ($SourcePort -le 0) {
    $p = Read-EnvValue 'DB_PORT_LAN'
    if (-not $p) { $p = Read-EnvValue 'DB_PORT' }
    $SourcePort = if ($p) { [int]$p } else { 3306 }
}
if (-not $SourceUser) { $SourceUser = Read-EnvValue 'DB_USER'; if (-not $SourceUser) { $SourceUser = 'root' } }
if (-not $SourcePass) { $SourcePass = Read-EnvValue 'DB_PASS'; if (-not $SourcePass) { $SourcePass = 'root' } }
if ($LocalPort -le 0) {
    $p = Read-EnvValue 'DB_PORT_LOCAL'
    $LocalPort = if ($p) { [int]$p } else { 3307 }
}

$databases = @(
    (Read-EnvValue 'DB_NAME'),
    (Read-EnvValue 'DB_NAME_SGC'),
    (Read-EnvValue 'DB_NAME_MEDICOS'),
    (Read-EnvValue 'DB_NAME_PC'),
    (Read-EnvValue 'DB_NAME_NORMATIVAS'),
    (Read-EnvValue 'DB_NAME_SENSORES')
) | Where-Object { $_ } | Select-Object -Unique

$dumpDir = Join-Path $root 'docker\dumps'
New-Item -ItemType Directory -Force -Path $dumpDir | Out-Null

Write-Host ''
Write-Host '  Biznaga - sync BD LAN -> Docker local'
Write-Host '  ------------------------------------'
Write-Host "  Origen : ${SourceHost}:${SourcePort}"
Write-Host "  Destino: 127.0.0.1:${LocalPort} (contenedor biznaga_mariadb)"
Write-Host "  Bases  : $($databases -join ', ')"
Write-Host ''

$running = docker inspect -f '{{.State.Running}}' biznaga_mariadb 2>$null
if ($running -ne 'true') {
    Write-Host '  Levantando MariaDB + phpMyAdmin...'
    docker compose up -d db phpmyadmin
    if ($LASTEXITCODE -ne 0) { throw 'docker compose up fallo' }
}

Write-Host '  Esperando healthy...'
$healthy = $false
for ($i = 1; $i -le 40; $i++) {
    $status = docker inspect --format '{{.State.Health.Status}}' biznaga_mariadb 2>$null
    if ($status -eq 'healthy') { $healthy = $true; break }
    Start-Sleep -Seconds 2
}
if (-not $healthy) {
    Write-Host '  Aviso: no reporto healthy a tiempo; se intenta de todos modos.'
}

$dumpMount = ($dumpDir -replace '\\', '/')
foreach ($db in $databases) {
    $fileName = "$db.sql"
    $outFile = Join-Path $dumpDir $fileName
    if (Test-Path $outFile) { Remove-Item $outFile -Force }

    Write-Host "  Dump $db desde LAN..."
    docker run --rm `
        -v "${dumpDir}:/dumps" `
        mariadb:10.6 `
        mysqldump `
        -h $SourceHost -P $SourcePort -u $SourceUser "-p$SourcePass" `
        --single-transaction --routines --triggers --events `
        --databases $db `
        -r "/dumps/$fileName"

    if ($LASTEXITCODE -ne 0 -or -not (Test-Path $outFile) -or (Get-Item $outFile).Length -lt 50) {
        throw "Dump vacio o fallido para $db (exit=$LASTEXITCODE)"
    }

    $mb = [math]::Round((Get-Item $outFile).Length / 1MB, 2)
    Write-Host "  Importando $db ($mb MB) al contenedor local..."
    docker cp $outFile "biznaga_mariadb:/tmp/$fileName"
    docker exec biznaga_mariadb mysql -uroot -proot -e "source /tmp/$fileName"
    if ($LASTEXITCODE -ne 0) { throw "Import fallo para $db" }
    docker exec biznaga_mariadb rm -f "/tmp/$fileName" | Out-Null
    Write-Host "  OK $db"
}

Write-Host ''
Write-Host '  Sync completado.'
Write-Host '  phpMyAdmin local: http://127.0.0.1:8080  (usuario root / root)'
Write-Host "  MySQL local:      127.0.0.1:$LocalPort"
Write-Host ''
