/**
 * Helper opcional (Windows): invoca un exportador eDrawings externo
 * (p.ej. xPort / Export.exe de CodeStack) para sacar JPG + STL.
 *
 * Uso desde toolcribEdrawingsIso.ts:
 *   powershell -File scripts/edrawings/Export-EDrawings.ps1 `
 *     -ExporterPath "C:\tools\export.exe" `
 *     -InputFile "D:\TOOL CRIB\part.eprt" `
 *     -OutDir "D:\TOOL CRIB\_iso_export" `
 *     -Formats ".jpg",".stl"
 *
 * Sin ExporterPath, el script solo documenta el fallo: el orquestador TS
 * puede seguir si ya existen companions .jpg/.stl junto al eDrawing.
 */

param(
  [Parameter(Mandatory = $true)][string]$InputFile,
  [Parameter(Mandatory = $true)][string]$OutDir,
  [string]$ExporterPath = "",
  [string[]]$Formats = @(".jpg", ".stl")
)

$ErrorActionPreference = "Stop"

if (-not (Test-Path -LiteralPath $InputFile)) {
  Write-Error "InputFile no existe: $InputFile"
  exit 1
}

New-Item -ItemType Directory -Force -Path $OutDir | Out-Null

if ([string]::IsNullOrWhiteSpace($ExporterPath)) {
  Write-Host "[edrawings] Sin -ExporterPath. Coloca un .jpg/.stl companion junto al eDrawing o pasa --exporter= al CLI TS."
  exit 2
}

if (-not (Test-Path -LiteralPath $ExporterPath)) {
  Write-Error "ExporterPath no existe: $ExporterPath"
  exit 1
}

$formatArgs = @("-format") + $Formats
& $ExporterPath -input $InputFile -outdir $OutDir @formatArgs
exit $LASTEXITCODE
