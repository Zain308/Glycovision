# Starts the GlycoVision app (Expo) with a clean cache.
# Run: double-click start-app.cmd, or in PowerShell: .\start-app.cmd
#
# Before starting it:
#  - checks node_modules and .env exist
#  - points EXPO_PUBLIC_API_URL at this PC's current network IP, because
#    the phone reaches the backend over Wi-Fi and routers change IPs
#  - offers to stop an old Expo session, whose cached build would keep
#    serving outdated code and settings

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$app = Join-Path $root 'glycovision-app'
$envFile = Join-Path $app '.env'
$metroPort = 8081
$backendPort = 8000

Write-Host ''
Write-Host '=== GlycoVision app ===' -ForegroundColor Cyan

if (-not (Test-Path (Join-Path $app 'node_modules'))) {
    Write-Host 'node_modules missing, installing packages (first run only)...' -ForegroundColor Yellow
    Push-Location $app
    npm install
    Pop-Location
}

if (-not (Test-Path $envFile)) {
    Write-Host 'glycovision-app\.env is missing.' -ForegroundColor Red
    Write-Host 'Copy glycovision-app\.env.example to .env and fill in the values.' -ForegroundColor Yellow
    exit 1
}

# --- Keep the backend address in .env pointing at this PC -------------
$ip = (Get-NetIPConfiguration |
        Where-Object { $_.IPv4DefaultGateway -and $_.NetAdapter.Status -eq 'Up' } |
        Select-Object -First 1).IPv4Address.IPAddress

if ($ip) {
    $wanted = "EXPO_PUBLIC_API_URL=http://${ip}:$backendPort"
    $lines = Get-Content $envFile
    $current = $lines | Where-Object { $_ -match '^EXPO_PUBLIC_API_URL=' } | Select-Object -First 1
    if ($current -ne $wanted) {
        $updated = $lines | ForEach-Object {
            if ($_ -match '^EXPO_PUBLIC_API_URL=') { $wanted } else { $_ }
        }
        if (-not $current) { $updated = @($updated) + $wanted }
        # UTF-8 without BOM, which Expo reads correctly.
        [System.IO.File]::WriteAllLines($envFile, [string[]]$updated, (New-Object System.Text.UTF8Encoding($false)))
        Write-Host "Backend address updated in .env: $current -> $wanted" -ForegroundColor Yellow
    } else {
        Write-Host "Backend address: http://${ip}:$backendPort" -ForegroundColor Green
    }
} else {
    Write-Host 'Could not detect this PC''s network IP; using EXPO_PUBLIC_API_URL from .env as is.' -ForegroundColor Yellow
}

# --- Warn if the backend isn't running ---------------------------------
if (-not (Get-NetTCPConnection -LocalPort $backendPort -State Listen -ErrorAction SilentlyContinue)) {
    Write-Host "Backend is not running on port $backendPort. Start it with start-backend.cmd in another terminal." -ForegroundColor Yellow
}

# --- Stop an old Expo session ------------------------------------------
$listener = Get-NetTCPConnection -LocalPort $metroPort -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
if ($listener) {
    $proc = Get-Process -Id $listener.OwningProcess -ErrorAction SilentlyContinue
    Write-Host "An old Expo session is still running (port $metroPort, '$($proc.ProcessName)', PID $($listener.OwningProcess))." -ForegroundColor Yellow
    $answer = Read-Host 'Stop it and start fresh? (Y/n)'
    if ($answer -and $answer -notmatch '^[Yy]') { exit 1 }
    Stop-Process -Id $listener.OwningProcess -Force
    Start-Sleep -Seconds 1
}

Write-Host ''
Write-Host 'Starting Expo with a clean cache. Scan the QR code with Expo Go (SDK 58).' -ForegroundColor Green
Write-Host 'Phone and PC must be on the same Wi-Fi. Press Ctrl+C to stop.'
Write-Host ''

Set-Location $app
npx expo start -c
