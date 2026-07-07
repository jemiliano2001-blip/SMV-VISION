# installSyncServerTask.ps1
#
# Registra (o reemplaza) la tarea programada de Windows 'SMV Sync Server':
# arranca el servidor HTTP local (localhost:3031) al iniciar sesion del usuario
# actual, en ventana oculta, sin limite de tiempo.
# Idempotente: volver a ejecutarlo reemplaza la tarea existente.
#
# Uso:  powershell -NoProfile -ExecutionPolicy Bypass -File scripts\installSyncServerTask.ps1
#
# Requisitos: npm install hecho (npx tsx disponible), .env.local con las
# variables de Firebase/Odoo en la raiz del repo.

$ErrorActionPreference = 'Stop'

$taskName = 'SMV Sync Server'
$runnerPath = Join-Path $PSScriptRoot 'runSyncServer.ps1'

if (-not (Test-Path $runnerPath)) {
    throw "No se encontro el runner: $runnerPath"
}

$action = New-ScheduledTaskAction `
    -Execute 'powershell.exe' `
    -Argument "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$runnerPath`""

# Disparar al iniciar sesion del usuario actual (no requiere privilegios de admin).
$trigger = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME

$settings = New-ScheduledTaskSettingsSet `
    -ExecutionTimeLimit ([TimeSpan]::Zero) `
    -AllowStartIfOnBatteries `
    -DontStopIfGoingOnBatteries `
    -RestartCount 10 `
    -RestartInterval (New-TimeSpan -Minutes 5)

# Reemplazar si ya existe (idempotente).
try {
    Unregister-ScheduledTask -TaskName $taskName -Confirm:$false -ErrorAction Stop
    Write-Host "Tarea existente '$taskName' eliminada para reemplazo."
} catch {
    # No existia: primera instalacion.
}

Register-ScheduledTask `
    -TaskName $taskName `
    -Action $action `
    -Trigger $trigger `
    -Settings $settings `
    -Description 'Servidor HTTP local (localhost:3031) que permite disparar el sync de Odoo desde el boton REFRESCAR de smv-brain.web.app. Log: logs\syncServer.log.' | Out-Null

Write-Host ""
Write-Host "Tarea '$taskName' registrada: arranca al iniciar sesion de $env:USERNAME."
Write-Host "Runner : $runnerPath"
Write-Host "Log    : $(Split-Path -Parent $PSScriptRoot)\logs\syncServer.log"
Write-Host ""
Write-Host "Iniciar ahora sin reiniciar sesion:"
Write-Host "  Start-ScheduledTask -TaskName '$taskName'"
Write-Host ""
Write-Host "Verificar estado:"
Write-Host "  Get-ScheduledTask -TaskName '$taskName' | Select-Object TaskName, State"
