# ============================================================
# autorizar.ps1
# Solo el jefe de departamento puede sincronizar el trabajo de
# residentes (SIB_Sistemas) hacia el repositorio privado:
#   https://github.com/Effectedbloom17/SitemaCapacitacion.git
#   rama: desarrollo
#
# Uso (desde la carpeta del proyecto):
#   .\autorizar.ps1
#   .\autorizar.ps1 -Mensaje "fix: ajuste de formularios SGC"
# ============================================================

param(
    [string]$Mensaje = "",
    [string]$RamaPrivada = "desarrollo",
    [string]$RepoPrivado = "https://github.com/Effectedbloom17/SitemaCapacitacion.git",
    [string]$RepoResidentes = "https://github.com/Effectedbloom17/SIB_Sistemas.git"
)

$ErrorActionPreference = "Stop"

if ($PSVersionTable.PSVersion.Major -ge 6) {
    $utf8 = [System.Text.UTF8Encoding]::new($false)
    [Console]::OutputEncoding = $utf8
    [Console]::InputEncoding = $utf8
}

# Credenciales: la contraseña NO se guarda en texto claro (solo hash SHA-256).
$ExpectedUser = "commit_admin_sib_authorized"
$ExpectedHash = "f72599ead5bc66ad7cb7622c27a36ab045ae2d29ce4e364fe7199431a257d692"

# Archivos/carpetas exclusivos del repo privado (producción / ops).
# En SIB_Sistemas no deben existir; en el privado nunca se borran al autorizar.
$ProtectedPaths = @(
    "deploy.ps1",
    "backup_db.ps1",
    "download-db-backups.ps1",
    "ACCESOS-Y-DEPLOY.md",
    "INFRAESTRUCTURA-PRODUCCION.md",
    "backend/MIGRACION-PRODUCCION.md",
    "docker/restore-backups.ps1",
    "backend/scripts/db-backup-mensual.sh",
    ".github/skills/deploy-produccion-biznaga",
    "reports/security-audit"
)

function Get-AuthHash {
    param([string]$User, [string]$Password)
    $bytes = [Text.Encoding]::UTF8.GetBytes("$User|$Password")
    $sha = [Security.Cryptography.SHA256]::Create()
    try {
        return (($sha.ComputeHash($bytes) | ForEach-Object { $_.ToString("x2") }) -join "")
    } finally {
        $sha.Dispose()
    }
}

function Test-Authorization {
    Write-Host ""
    Write-Host "Autorizacion requerida (jefe de departamento)" -ForegroundColor Yellow
    $user = Read-Host "Usuario"
    $secure = Read-Host "Contraseña" -AsSecureString
    $bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
    try {
        $pass = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr)
    } finally {
        [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr)
    }

    if ($user -ne $ExpectedUser) {
        return $false
    }
    $hash = Get-AuthHash -User $user -Password $pass
    $pass = $null
    return ($hash -eq $ExpectedHash)
}

function Invoke-Git {
    param([Parameter(Mandatory = $true)][string[]]$Args, [string]$WorkDir = $PSScriptRoot)
    Push-Location $WorkDir
    try {
        & git @Args
        if ($LASTEXITCODE -ne 0) {
            throw "git $($Args -join ' ') fallo con codigo $LASTEXITCODE"
        }
    } finally {
        Pop-Location
    }
}

function Get-RelativePathUnix {
    param([string]$FullPath, [string]$Root)
    $rel = $FullPath.Substring($Root.Length).TrimStart('\', '/')
    return ($rel -replace '\\', '/')
}

function Test-IsProtected {
    param([string]$RelPath)
    $norm = ($RelPath -replace '\\', '/').TrimStart('/')
    foreach ($p in $ProtectedPaths) {
        $pp = ($p -replace '\\', '/').TrimStart('/')
        if ($norm -eq $pp -or $norm.StartsWith("$pp/")) {
            return $true
        }
    }
    return $false
}

function Remove-ProtectedFromTree {
    param([string]$Root)
    foreach ($p in $ProtectedPaths) {
        $full = Join-Path $Root ($p -replace '/', '\')
        if (Test-Path -LiteralPath $full) {
            Remove-Item -LiteralPath $full -Recurse -Force
            Write-Host "  Excluido del arbol de residentes: $p" -ForegroundColor DarkGray
        }
    }
}

if (-not (Test-Authorization)) {
    Write-Host "Credenciales incorrectas. No se autorizo la sincronizacion." -ForegroundColor Red
    exit 1
}

Write-Host "Autorizacion aceptada." -ForegroundColor Green

$root = $PSScriptRoot
if (-not (Test-Path (Join-Path $root ".git"))) {
    Write-Host "Este script debe ejecutarse en la raiz del repositorio." -ForegroundColor Red
    exit 1
}

# Quitar del working tree local cualquier archivo de produccion que no deba estar en SIB.
Remove-ProtectedFromTree -Root $root

$status = & git -C $root status --porcelain
if ($status) {
    if ([string]::IsNullOrWhiteSpace($Mensaje)) {
        $Mensaje = Read-Host "Mensaje del commit (residentes -> privado)"
    }
    if ([string]::IsNullOrWhiteSpace($Mensaje)) {
        $Mensaje = "chore: sincronizacion autorizada $(Get-Date -Format 'yyyy-MM-dd HH:mm')"
    }

    Invoke-Git -Args @("add", "-A")
    # Asegurar que archivos protegidos no queden staged si alguien los creo.
    foreach ($p in $ProtectedPaths) {
        & git -C $root reset -q -- $p 2>$null
        & git -C $root rm -r --cached -f --ignore-unmatch -- $p 2>$null | Out-Null
    }
    $staged = & git -C $root diff --cached --name-only
    if ($staged) {
        Invoke-Git -Args @("commit", "-m", $Mensaje)
        Write-Host "Commit local creado." -ForegroundColor Green
    } else {
        Write-Host "No hay cambios para commitear (tras excluir archivos protegidos)." -ForegroundColor DarkGray
    }
} else {
    Write-Host "Working tree limpio; se sincronizara el HEAD actual." -ForegroundColor DarkGray
}

# Publicar tambien al remoto de residentes si existe.
$remotes = & git -C $root remote
if ($remotes -match '(?m)^origin$') {
    $branch = (& git -C $root rev-parse --abbrev-ref HEAD).Trim()
    Write-Host "Publicando en remoto de residentes (origin / $branch)..." -ForegroundColor Yellow
    try {
        Invoke-Git -Args @("push", "-u", "origin", "HEAD")
    } catch {
        Write-Host "Aviso: no se pudo hacer push a origin. Se continuara con el repo privado." -ForegroundColor DarkYellow
        Write-Host "  $($_.Exception.Message)" -ForegroundColor DarkYellow
    }
}

$tempRoot = Join-Path $env:TEMP ("sib-autorizar-" + [guid]::NewGuid().ToString("N"))
New-Item -ItemType Directory -Path $tempRoot | Out-Null

try {
    Write-Host "Clonando repo privado ($RamaPrivada)..." -ForegroundColor Yellow
    & git clone --branch $RamaPrivada --single-branch $RepoPrivado $tempRoot
    if ($LASTEXITCODE -ne 0) {
        throw "No se pudo clonar $RepoPrivado (rama $RamaPrivada)."
    }

    # Resguardar archivos protegidos del privado.
    $backupDir = Join-Path $env:TEMP ("sib-protected-" + [guid]::NewGuid().ToString("N"))
    New-Item -ItemType Directory -Path $backupDir | Out-Null
    foreach ($p in $ProtectedPaths) {
        $src = Join-Path $tempRoot ($p -replace '/', '\')
        if (Test-Path -LiteralPath $src) {
            $dst = Join-Path $backupDir ($p -replace '/', '\')
            $dstParent = Split-Path -Parent $dst
            if (-not (Test-Path $dstParent)) {
                New-Item -ItemType Directory -Path $dstParent -Force | Out-Null
            }
            Copy-Item -LiteralPath $src -Destination $dst -Recurse -Force
        }
    }

    Write-Host "Copiando cambios de residentes al arbol privado..." -ForegroundColor Yellow

    # Borrar tracked files del privado excepto protegidos y .git
    $privateFiles = & git -C $tempRoot ls-files
    foreach ($f in $privateFiles) {
        if (Test-IsProtected -RelPath $f) { continue }
        $full = Join-Path $tempRoot ($f -replace '/', '\')
        if (Test-Path -LiteralPath $full) {
            Remove-Item -LiteralPath $full -Force -ErrorAction SilentlyContinue
        }
    }

    # Copiar archivos versionables del repo actual (residentes)
    $sourceFiles = & git -C $root ls-files
    foreach ($f in $sourceFiles) {
        if (Test-IsProtected -RelPath $f) { continue }
        $src = Join-Path $root ($f -replace '/', '\')
        if (-not (Test-Path -LiteralPath $src)) { continue }
        $dst = Join-Path $tempRoot ($f -replace '/', '\')
        $dstParent = Split-Path -Parent $dst
        if (-not (Test-Path $dstParent)) {
            New-Item -ItemType Directory -Path $dstParent -Force | Out-Null
        }
        Copy-Item -LiteralPath $src -Destination $dst -Force
    }

    # Restaurar archivos protegidos del privado
    foreach ($p in $ProtectedPaths) {
        $bak = Join-Path $backupDir ($p -replace '/', '\')
        if (Test-Path -LiteralPath $bak) {
            $dst = Join-Path $tempRoot ($p -replace '/', '\')
            $dstParent = Split-Path -Parent $dst
            if (-not (Test-Path $dstParent)) {
                New-Item -ItemType Directory -Path $dstParent -Force | Out-Null
            }
            if (Test-Path -LiteralPath $dst) {
                Remove-Item -LiteralPath $dst -Recurse -Force
            }
            Copy-Item -LiteralPath $bak -Destination $dst -Recurse -Force
        }
    }

    Remove-Item -LiteralPath $backupDir -Recurse -Force -ErrorAction SilentlyContinue

    Push-Location $tempRoot
    try {
        git add -A
        $pending = git status --porcelain
        if (-not $pending) {
            Write-Host "El repo privado ya estaba al dia; no hay commit nuevo." -ForegroundColor DarkGray
        } else {
            if ([string]::IsNullOrWhiteSpace($Mensaje)) {
                $Mensaje = "chore: sincronizacion autorizada desde SIB $(Get-Date -Format 'yyyy-MM-dd HH:mm')"
            }
            git commit -m $Mensaje
            if ($LASTEXITCODE -ne 0) { throw "No se pudo crear el commit en el repo privado." }
            Write-Host "Enviando a $RepoPrivado ($RamaPrivada)..." -ForegroundColor Yellow
            git push origin "HEAD:$RamaPrivada"
            if ($LASTEXITCODE -ne 0) { throw "Push al repo privado fallo." }
            Write-Host "Sincronizacion al repo privado completada." -ForegroundColor Green
            Write-Host "Siguiente paso (solo jefe): deploy.ps1 / backup_db.ps1 en el repo privado." -ForegroundColor Cyan
        }
    } finally {
        Pop-Location
    }
} finally {
    if (Test-Path -LiteralPath $tempRoot) {
        Remove-Item -LiteralPath $tempRoot -Recurse -Force -ErrorAction SilentlyContinue
    }
}
