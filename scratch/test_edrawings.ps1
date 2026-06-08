$e = New-Object -ComObject "EModelView.EModelViewControl"
$path = "D:\proyectos_code\SMV\SMV-VISION\TOOL CRIB\14259-63-20-93\14259-63-20-93.SLDPRT"
$out = "D:\proyectos_code\SMV\SMV-VISION\scratch\test.png"
Write-Host "Opening doc..."
$e.OpenDoc($path, $false, $false, $false, "")
Start-Sleep -Seconds 8
Write-Host "Setting view..."
try {
  $e.ViewOrientation = 4 # Isometric is usually 4 or 5
  Start-Sleep -Seconds 2
} catch {
  Write-Host "Failed to set view"
}
Write-Host "Saving image..."
$e.Save($out, $false, "")
Write-Host "Done."
