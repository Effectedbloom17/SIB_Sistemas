# Abre el MariaDB de Docker (biznaga_mariadb) a otras PCs de la misma LAN.
# Ejecutar en la PC que corre el contenedor.
# Si el firewall pide administrador: PowerShell -> Ejecutar como administrador.

$ErrorActionPreference = 'Continue'
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

function Get-LanIPv4 {
    $addrs = Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue |
        Where-Object {
            $_.IPAddress -notlike '127.*' -and
            $_.PrefixOrigin -ne 'WellKnown' -and
            $_.InterfaceAlias -notmatch 'WSL|vEthernet|Loopback|Docker|Virtual|Bluetooth'
        }
    $prefer = $addrs | Where-Object { $_.InterfaceAlias -match 'Wi-Fi|WiFi|Ethernet|LAN' } | Select-Object -First 1
    if ($prefer) { return $prefer.IPAddress }
    if ($addrs) { return ($addrs | Select-Object -First 1).IPAddress }
    return $null
}

$lanIp = Get-LanIPv4
Write-Host ''
Write-Host '  Biznaga - acceso LAN al contenedor MariaDB'
Write-Host '  ----------------------------------------'

if ($lanIp) {
    Write-Host "  IP de esta PC en la LAN: $lanIp"
} else {
    Write-Host '  No se detecto IP LAN. Conecte Wi-Fi/Ethernet y vuelva a ejecutar.'
}

$running = docker inspect -f '{{.State.Running}}' biznaga_mariadb 2>$null
if ($running -ne 'true') {
    Write-Host ''
    Write-Host '  Contenedor biznaga_mariadb no esta corriendo. Levantando con docker compose...'
    docker compose up -d db phpmyadmin
    if ($LASTEXITCODE -ne 0) {
        Write-Host '  Error: docker compose no pudo levantar db/phpmyadmin.'
        exit 1
    }
    Write-Host '  Esperando a que MariaDB quede healthy...'
    $healthy = $false
    for ($i = 1; $i -le 40; $i++) {
        $status = docker inspect --format '{{.State.Health.Status}}' biznaga_mariadb 2>$null
        if ($status -eq 'healthy') { $healthy = $true; break }
        Start-Sleep -Seconds 2
    }
    if (-not $healthy) {
        Write-Host '  Aviso: el contenedor no reporto healthy a tiempo; se intentan grants de todos modos.'
    }
} else {
    Write-Host '  Contenedor biznaga_mariadb ya esta en ejecucion (no se recrea, para no perder datos).'
}

Write-Host '  Aplicando permisos root@% (conexiones desde otras PCs)...'
$sql = "CREATE USER IF NOT EXISTS 'root'@'%' IDENTIFIED BY 'root'; GRANT ALL PRIVILEGES ON *.* TO 'root'@'%' WITH GRANT OPTION; FLUSH PRIVILEGES;"
docker exec biznaga_mariadb mysql -uroot -proot -e $sql 2>$null
if ($LASTEXITCODE -eq 0) {
    Write-Host '  Permisos MariaDB listos.'
} else {
    Write-Host '  Aviso: no se pudieron aplicar grants. Confirme que biznaga_mariadb este sano.'
}

function Test-FwRule([string]$Name) {
    $existing = netsh advfirewall firewall show rule name="$Name" 2>$null
    return ($existing -match [regex]::Escape($Name))
}

$rule3306 = 'Biznaga MariaDB LAN'
$rule8080 = 'Biznaga phpMyAdmin LAN'
$needFw = -not (Test-FwRule $rule3306) -or -not (Test-FwRule $rule8080)

Write-Host ''
if (-not $needFw) {
    Write-Host '  Firewall: reglas LAN ya existen (3306 y 8080).'
} else {
    Write-Host '  Firewall: se pedira permiso de administrador para abrir 3306 y 8080...'
    $cmd = @(
        "netsh advfirewall firewall add rule name=`"$rule3306`" dir=in action=allow protocol=TCP localport=3306 profile=private,domain"
        "netsh advfirewall firewall add rule name=`"$rule8080`" dir=in action=allow protocol=TCP localport=8080 profile=private,domain"
    ) -join '; '
    Start-Process -FilePath "powershell" -ArgumentList "-NoProfile -Command $cmd" -Verb RunAs -Wait -WindowStyle Hidden
    if ((Test-FwRule $rule3306) -and (Test-FwRule $rule8080)) {
        Write-Host '  Firewall: abierto TCP 3306 y 8080 (red privada).'
    } else {
        Write-Host '  Firewall: no se pudieron crear las reglas. Ejecute como administrador:'
        Write-Host '    npm run db:lan'
    }
}

Write-Host ''
Write-Host '  En las OTRAS PCs, backend/.env debe tener:'
if ($lanIp) {
    Write-Host '    DB_HOST_LOCAL=127.0.0.1'
    Write-Host "    DB_HOST_LAN=$lanIp"
} else {
    Write-Host '    DB_HOST_LAN=<IP de esta PC>'
}
Write-Host '  El backend prueba primero localhost; si no hay Docker ahi, usa DB_HOST_LAN.'
Write-Host ''
Write-Host '  Prueba desde otra PC (misma WiFi):'
if ($lanIp) {
    Write-Host "    phpMyAdmin: http://${lanIp}:8080"
    Write-Host "    mysql -h $lanIp -P 3306 -u root -proot"
}
Write-Host ''
