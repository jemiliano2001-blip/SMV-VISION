# runOdooSync.ps1
#
# Wrapper para Task Scheduler: ejecuta el sync completo de Odoo
# (scripts/syncOdoo.ts) desde la raiz del repo y anexa la salida a
# logs/syncOdoo.log. El resultado de cada corrida tambien queda en
# Firestore (syncMeta/odoo), que es lo que muestra el chip de la app.
#
# Uso manual:  powershell -NoProfile -ExecutionPolicy Bypass -File scripts\runOdooSync.ps1
# Programado:  ver scripts\installSyncTask.ps1

$ErrorActionPreference = 'Continue'

$repoRoot = Split-Path -Parent $PSScriptRoot
$logDir = Join-Path $repoRoot 'logs'
$logFile = Join-Path $logDir 'syncOdoo.log'

if (-not (Test-Path $logDir)) {
    New-Item -ItemType Directory -Path $logDir | Out-Null
}

# Rotacion simple: truncar cuando el log supera 1 MB.
if ((Test-Path $logFile) -and ((Get-Item $logFile).Length -gt 1MB)) {
    Clear-Content $logFile
}

Set-Location $repoRoot

$startTs = Get-Date -Format 'yyyy-MM-dd HH:mm:ss'
Add-Content -Path $logFile -Value "`r`n===== [$startTs] sync iniciado ====="

# cmd /c para que stdout+stderr del proceso node lleguen al log sin que
# PowerShell 5.1 envuelva stderr en ErrorRecords.
cmd /c "npx tsx scripts\syncOdoo.ts >> `"$logFile`" 2>&1"
$exitCode = $LASTEXITCODE

$endTs = Get-Date -Format 'yyyy-MM-dd HH:mm:ss'
Add-Content -Path $logFile -Value "===== [$endTs] sync terminado (exit $exitCode) ====="

exit $exitCode
