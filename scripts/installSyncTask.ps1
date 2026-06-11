# installSyncTask.ps1
#
# Registra (o reemplaza) la tarea programada de Windows 'SMV Odoo Sync':
# corre scripts\runOdooSync.ps1 cada hora entre 7:00 y 19:00, lunes a
# viernes, con la ventana oculta. Idempotente: volver a ejecutarlo
# reemplaza la tarea existente.
#
# Uso:  powershell -NoProfile -ExecutionPolicy Bypass -File scripts\installSyncTask.ps1
#
# Requisitos en la raiz del repo: .env.local con ODOO_* y
# FIREBASE_SERVICE_ACCOUNT_PATH, y npm install hecho (npx tsx disponible).

$ErrorActionPreference = 'Stop'

$taskName = 'SMV Odoo Sync'
$runnerPath = Join-Path $PSScriptRoot 'runOdooSync.ps1'

if (-not (Test-Path $runnerPath)) {
    throw "No se encontro el runner: $runnerPath"
}

$action = New-ScheduledTaskAction `
    -Execute 'powershell.exe' `
    -Argument "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$runnerPath`""

# Disparo semanal L-V a las 7:00, repitiendo cada hora durante 12 horas
# (ultima corrida del dia: 19:00).
$trigger = New-ScheduledTaskTrigger `
    -Weekly -DaysOfWeek Monday, Tuesday, Wednesday, Thursday, Friday -At 7:00am
$repetition = (New-ScheduledTaskTrigger -Once -At 7:00am `
    -RepetitionInterval (New-TimeSpan -Hours 1) `
    -RepetitionDuration (New-TimeSpan -Hours 12)).Repetition
$trigger.Repetition = $repetition

$settings = New-ScheduledTaskSettingsSet `
    -StartWhenAvailable `
    -AllowStartIfOnBatteries `
    -DontStopIfGoingOnBatteries `
    -ExecutionTimeLimit (New-TimeSpan -Minutes 15)

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
    -Description 'Sincroniza ordenes de venta de Odoo a Firestore (SMV Vision). Log: logs\syncOdoo.log; estado: syncMeta/odoo.' | Out-Null

Write-Host "Tarea '$taskName' registrada: cada hora de 7:00 a 19:00, L-V."
Write-Host "Runner: $runnerPath"
Write-Host "Probar ahora:  Start-ScheduledTask -TaskName '$taskName'"
