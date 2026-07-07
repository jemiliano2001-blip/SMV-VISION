# runSyncServer.ps1
#
# Wrapper para Task Scheduler: arranca el servidor HTTP local de sync
# (scripts/syncServer.ts) que permite que el boton REFRESCAR de la app
# dispare npm run sync:odoo desde el navegador.
#
# Escucha en http://localhost:3031. El proceso queda corriendo hasta que
# Windows lo detiene (logoff, shutdown, tarea cancelada).
#
# Uso manual:  powershell -NoProfile -ExecutionPolicy Bypass -File scripts\runSyncServer.ps1
# Programado:  ver scripts\installSyncServerTask.ps1

$ErrorActionPreference = 'Continue'

$repoRoot = Split-Path -Parent $PSScriptRoot
$logDir = Join-Path $repoRoot 'logs'
$logFile = Join-Path $logDir 'syncServer.log'

if (-not (Test-Path $logDir)) {
    New-Item -ItemType Directory -Path $logDir | Out-Null
}

# Rotacion simple: truncar cuando el log supera 2 MB.
if ((Test-Path $logFile) -and ((Get-Item $logFile).Length -gt 2MB)) {
    Clear-Content $logFile
}

Set-Location $repoRoot

$startTs = Get-Date -Format 'yyyy-MM-dd HH:mm:ss'
Add-Content -Path $logFile -Value "`r`n===== [$startTs] syncServer iniciado ====="

# Redirigir stdout + stderr al log.
cmd /c "npx tsx scripts\syncServer.ts >> `"$logFile`" 2>&1"
$exitCode = $LASTEXITCODE

$endTs = Get-Date -Format 'yyyy-MM-dd HH:mm:ss'
Add-Content -Path $logFile -Value "===== [$endTs] syncServer terminado (exit $exitCode) ====="

exit $exitCode
