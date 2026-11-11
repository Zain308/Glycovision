# Starts the GlycoVision backend (FastAPI) on port 8000.
# Run: double-click start-backend.cmd, or in PowerShell: .\start-backend.cmd

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$backend = Join-Path $root 'glycovision-backend'
$python = Join-Path $backend 'venv\Scripts\python.exe'
$port = 8000

Write-Host ''
Write-Host '=== GlycoVision backend ===' -ForegroundColor Cyan

if (-not (Test-Path $python)) {
    Write-Host "Python virtual environment not found: $python" -ForegroundColor Red
    Write-Host 'Create it once with:' -ForegroundColor Yellow
    Write-Host '  cd glycovision-backend; python -m venv venv; .\venv\Scripts\python.exe -m pip install -r requirements.txt'
    exit 1
}

if (-not (Test-Path (Join-Path $backend '.env'))) {
    Write-Host 'glycovision-backend\.env is missing.' -ForegroundColor Red
    Write-Host 'Copy glycovision-backend\.env.example to .env and fill in the values.' -ForegroundColor Yellow
    exit 1
}

# An old backend still running would block the port.
$listener = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
if ($listener) {
    $proc = Get-Process -Id $listener.OwningProcess -ErrorAction SilentlyContinue
    Write-Host "Port $port is already in use by '$($proc.ProcessName)' (PID $($listener.OwningProcess))." -ForegroundColor Yellow
    $answer = Read-Host 'Stop it and start a fresh backend? (Y/n)'
    if ($answer -and $answer -notmatch '^[Yy]') { exit 1 }
    Stop-Process -Id $listener.OwningProcess -Force
    Start-Sleep -Seconds 1
}

Write-Host "Starting on http://0.0.0.0:$port  (health check: http://localhost:$port/health)" -ForegroundColor Green
Write-Host 'Press Ctrl+C to stop.'
Write-Host ''

Set-Location $backend
& $python -m uvicorn main:app --host 0.0.0.0 --port $port --reload
