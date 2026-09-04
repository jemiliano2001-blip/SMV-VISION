[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)][ValidateNotNullOrEmpty()][string]$InputFile,
  [Parameter(Mandatory = $true)][ValidateNotNullOrEmpty()][string]$OutDir,
  [string[]]$Formats = @('.jpg', '.stl'),
  [ValidateRange(1, 3600)][int]$TimeoutSeconds = 180,
  # iso: fuerza vista isométrica (modelos 3D: .sldprt/.easm/.eprt).
  # flat: conserva la vista del documento tal cual (planos acotados .slddrw) y
  # solo hace zoom-to-fit — forzar isométrica en un dibujo 2D lo deja ilegible.
  [ValidateSet('iso', 'flat')][string]$Mode = 'iso',
  # El control ActiveX renderiza al tamano de su ventana host. Sin ventana
  # visible eDrawings usa ~382x366 px, y ese raster minusculo es lo que acaba
  # dentro del PDF del catalogo: cotas y cajetin ilegibles. ShowFullScreen
  # promueve el control a una ventana del tamano del monitor (~2878x1798 en
  # 1080p), que es la unica palanca de resolucion que expone la API: Width y
  # Height son de solo lectura y Save() no acepta dimensiones.
  # Escotilla de escape por si una maquina no tolera la ventana full screen.
  [switch]$NoFullScreen
)

$ErrorActionPreference = 'Stop'
$script:ExitCode = 0
$officeDocument = $null
$viewer = $null
$stagingDirectory = $null
$resolvedOutDir = $null
$jpgPromotionPath = $null
$stlPromotionPath = $null
$eventSubscription = $null
$script:FullScreenActive = $false

function Write-ExporterStage {
  param([Parameter(Mandatory = $true)][string]$Stage)
  [Console]::Error.WriteLine("[edrawings-native] stage=$Stage")
  [Console]::Error.Flush()
}

function Get-NormalizedFormats {
  param([string[]]$RawFormats)
  $normalized = New-Object System.Collections.Generic.List[string]
  foreach ($rawFormat in $RawFormats) {
    foreach ($part in ([string]$rawFormat -split ',')) {
      $format = $part.Trim().ToLowerInvariant()
      if ([string]::IsNullOrWhiteSpace($format)) { continue }
      if (-not $format.StartsWith('.')) { $format = ".$format" }
      if ($format -notin @('.jpg', '.stl')) {
        Write-Warning "Formato no soportado por este adaptador: $format. Se omitira."
        continue
      }
      if (-not $normalized.Contains($format)) { $normalized.Add($format) }
    }
  }
  if (-not $normalized.Contains('.jpg')) {
    Write-Warning 'JPG es obligatorio para el pipeline; se agregara aunque no aparezca en -Formats.'
    $normalized.Insert(0, '.jpg')
  }
  return $normalized.ToArray()
}

function Test-ValidBinaryStl {
  param([Parameter(Mandatory = $true)][string]$Path)
  if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) { return $false }
  $stream = $null
  try {
    $stream = [IO.File]::Open($Path, [IO.FileMode]::Open, [IO.FileAccess]::Read, [IO.FileShare]::Read)
    if ($stream.Length -lt 84) { return $false }
    $stream.Position = 80
    $countBytes = New-Object byte[] 4
    if ($stream.Read($countBytes, 0, 4) -ne 4) { return $false }
    $triangleCount = [BitConverter]::ToUInt32($countBytes, 0)
    $expectedLength = 84L + ([int64]$triangleCount * 50L)
    return $triangleCount -gt 0 -and $stream.Length -eq $expectedLength
  } catch { return $false } finally {
    if ($null -ne $stream) { $stream.Dispose() }
  }
}

function Initialize-EDrawingsEventBridge {
  $documentClassKey = Get-Item -LiteralPath 'Registry::HKEY_CLASSES_ROOT\EDrawingOfficeAutomator.Document\CLSID' -ErrorAction Stop
  $documentClassId = [string]$documentClassKey.GetValue('')
  if ([string]::IsNullOrWhiteSpace($documentClassId)) {
    throw 'No se pudo resolver el CLSID de EDrawingOfficeAutomator.Document.'
  }
  $localServerKey = Get-Item -LiteralPath "Registry::HKEY_CLASSES_ROOT\CLSID\$documentClassId\LocalServer32" -ErrorAction Stop
  $localServerCommand = [string]$localServerKey.GetValue('')
  $serverMatch = [regex]::Match($localServerCommand, '^\s*"(?<path>[^"]+\.exe)"|^\s*(?<path>[^\s]+\.exe)')
  if (-not $serverMatch.Success) {
    throw 'No se pudo localizar eDrawingOfficeAutomator.exe desde el registro COM.'
  }
  $serverPath = $serverMatch.Groups['path'].Value
  $interopPath = Join-Path -Path (Split-Path -Parent $serverPath) -ChildPath 'eDrawings.Interop.EModelViewControl.dll'
  if (-not (Test-Path -LiteralPath $interopPath -PathType Leaf)) {
    throw "No se encontro la interfaz de eventos eDrawings: $interopPath"
  }
  Add-Type -Path $interopPath
  Add-Type -AssemblyName System.Windows.Forms
  if (-not ('SmvVisionEDrawingsEventBridge' -as [type])) {
    Add-Type -TypeDefinition @'
public static class SmvVisionEDrawingsEventBridge
{
  public static bool LoadFinished;
  public static bool SaveFinished;
  public static string LoadFailure;
  public static string SaveFailure;

  public static void ResetLoad() { LoadFinished = false; LoadFailure = null; }
  public static void ResetSave() { SaveFinished = false; SaveFailure = null; }
  public static void OnFinishedLoadingDocument(string fileName) { LoadFinished = true; }
  public static void OnFinishedSavingDocument() { SaveFinished = true; }
  public static void OnFailedLoadingDocument(string fileName, int errorCode, string errorString) { LoadFailure = fileName + "|" + errorCode + "|" + errorString; }
  public static void OnFailedSavingDocument(string fileName, int errorCode, string errorString) { SaveFailure = fileName + "|" + errorCode + "|" + errorString; }
}
'@
  }
  return [pscustomobject]@{
    EventGuid = [eDrawings.Interop.EModelViewControl._IEModelViewControlEvents].GUID
    LoadFinished = [System.Delegate]::CreateDelegate([eDrawings.Interop.EModelViewControl._IEModelViewControlEvents_OnFinishedLoadingDocumentEventHandler], [SmvVisionEDrawingsEventBridge], 'OnFinishedLoadingDocument')
    SaveFinished = [System.Delegate]::CreateDelegate([eDrawings.Interop.EModelViewControl._IEModelViewControlEvents_OnFinishedSavingDocumentEventHandler], [SmvVisionEDrawingsEventBridge], 'OnFinishedSavingDocument')
    LoadFailed = [System.Delegate]::CreateDelegate([eDrawings.Interop.EModelViewControl._IEModelViewControlEvents_OnFailedLoadingDocumentEventHandler], [SmvVisionEDrawingsEventBridge], 'OnFailedLoadingDocument')
    SaveFailed = [System.Delegate]::CreateDelegate([eDrawings.Interop.EModelViewControl._IEModelViewControlEvents_OnFailedSavingDocumentEventHandler], [SmvVisionEDrawingsEventBridge], 'OnFailedSavingDocument')
  }
}

function Connect-EDrawingsEventBridge {
  param(
    [Parameter(Mandatory = $true)]$Viewer,
    [Parameter(Mandatory = $true)]$Bridge
  )
  [Runtime.InteropServices.ComEventsHelper]::Combine($Viewer, $Bridge.EventGuid, 3, $Bridge.LoadFinished)
  [Runtime.InteropServices.ComEventsHelper]::Combine($Viewer, $Bridge.EventGuid, 4, $Bridge.SaveFinished)
  [Runtime.InteropServices.ComEventsHelper]::Combine($Viewer, $Bridge.EventGuid, 5, $Bridge.LoadFailed)
  [Runtime.InteropServices.ComEventsHelper]::Combine($Viewer, $Bridge.EventGuid, 6, $Bridge.SaveFailed)
  return [pscustomobject]@{ Viewer = $Viewer; Bridge = $Bridge }
}

function Disconnect-EDrawingsEventBridge {
  param($Subscription)
  if ($null -eq $Subscription) { return }
  foreach ($event in @(
    @(3, $Subscription.Bridge.LoadFinished),
    @(4, $Subscription.Bridge.SaveFinished),
    @(5, $Subscription.Bridge.LoadFailed),
    @(6, $Subscription.Bridge.SaveFailed)
  )) {
    try { [Runtime.InteropServices.ComEventsHelper]::Remove($Subscription.Viewer, $Subscription.Bridge.EventGuid, $event[0], $event[1]) } catch { }
  }
}

function Invoke-STAEventPump {
  if ([Threading.Thread]::CurrentThread.GetApartmentState() -ne [Threading.ApartmentState]::STA) {
    throw 'El puente de eventos eDrawings requiere un hilo STA.'
  }
  [Windows.Forms.Application]::DoEvents()
}

function Wait-EDrawingsEvent {
  param(
    [Parameter(Mandatory = $true)][ValidateSet('load', 'save')][string]$Operation,
    [Parameter(Mandatory = $true)][int]$TimeoutMilliseconds
  )
  $stopwatch = [Diagnostics.Stopwatch]::StartNew()
  while ($stopwatch.ElapsedMilliseconds -lt $TimeoutMilliseconds) {
    Invoke-STAEventPump
    $finished = if ($Operation -eq 'load') { [SmvVisionEDrawingsEventBridge]::LoadFinished } else { [SmvVisionEDrawingsEventBridge]::SaveFinished }
    $failure = if ($Operation -eq 'load') { [SmvVisionEDrawingsEventBridge]::LoadFailure } else { [SmvVisionEDrawingsEventBridge]::SaveFailure }
    if (-not [string]::IsNullOrWhiteSpace($failure)) {
      throw "eDrawings notifico un fallo al ${Operation}: $failure"
    }
    if ($finished) { return }
    Start-Sleep -Milliseconds 100
  }
  throw "eDrawings no confirmo el $Operation en $([math]::Ceiling($TimeoutMilliseconds / 1000)) segundos."
}

function Promote-Artifact {
  param(
    [Parameter(Mandatory = $true)][string]$StagedPath,
    [Parameter(Mandatory = $true)][string]$PromotionPath,
    [Parameter(Mandatory = $true)][string]$OutputPath,
    [switch]$ValidateBinaryStl
  )
  $stagedInfo = Get-Item -LiteralPath $StagedPath -ErrorAction Stop
  Copy-Item -LiteralPath $StagedPath -Destination $PromotionPath -Force
  $promotedInfo = Get-Item -LiteralPath $PromotionPath -ErrorAction Stop
  if ($promotedInfo.Length -ne $stagedInfo.Length) {
    throw "La copia temporal de $([IO.Path]::GetFileName($OutputPath)) no coincide con el artefacto confirmado."
  }
  if ($ValidateBinaryStl -and -not (Test-ValidBinaryStl -Path $PromotionPath)) {
    throw 'La copia temporal del STL no conserva una estructura binaria valida.'
  }
  Move-Item -LiteralPath $PromotionPath -Destination $OutputPath -Force
  return $stagedInfo
}

try {
  if ([Threading.Thread]::CurrentThread.GetApartmentState() -ne [Threading.ApartmentState]::STA) {
    throw 'El supervisor eDrawings requiere powershell.exe con -Sta.'
  }
  if (-not [Environment]::Is64BitProcess) {
    throw 'El supervisor eDrawings debe ejecutarse en Windows PowerShell x64.'
  }
  if (-not (Test-Path -LiteralPath $InputFile -PathType Leaf)) {
    throw "InputFile no existe o no es un archivo: $InputFile"
  }

  $resolvedInput = [IO.Path]::GetFullPath((Resolve-Path -LiteralPath $InputFile).Path)
  if (-not (Test-Path -LiteralPath $OutDir -PathType Container)) {
    [void](New-Item -ItemType Directory -Path $OutDir -Force)
  }
  $resolvedOutDir = [IO.Path]::GetFullPath((Resolve-Path -LiteralPath $OutDir).Path)
  $normalizedFormats = @(Get-NormalizedFormats -RawFormats $Formats)
  $sourceStem = [IO.Path]::GetFileNameWithoutExtension($resolvedInput)
  $jpgOutputPath = Join-Path -Path $resolvedOutDir -ChildPath "$sourceStem.jpg"
  $stlOutputPath = if ($normalizedFormats -contains '.stl') {
    Join-Path -Path $resolvedOutDir -ChildPath "$sourceStem.stl"
  } else { '' }
  if ($resolvedInput -in @($jpgOutputPath, $stlOutputPath)) {
    throw 'El exportador no puede sobrescribir el archivo fuente.'
  }
  foreach ($outputPath in @($jpgOutputPath, $stlOutputPath)) {
    if (-not [string]::IsNullOrWhiteSpace($outputPath) -and
        (Test-Path -LiteralPath $outputPath -PathType Leaf)) {
      Remove-Item -LiteralPath $outputPath -Force
    }
  }

  $stagingDirectory = Join-Path -Path ([IO.Path]::GetTempPath()) -ChildPath (
    'smv-vision-edrawings-' + [Guid]::NewGuid().ToString('N')
  )
  [void](New-Item -ItemType Directory -Path $stagingDirectory)
  $stagedJpgPath = Join-Path -Path $stagingDirectory -ChildPath "$sourceStem.jpg"
  $stagedStlPath = if (-not [string]::IsNullOrWhiteSpace($stlOutputPath)) {
    Join-Path -Path $stagingDirectory -ChildPath "$sourceStem.stl"
  } else { '' }
  $promotionId = [Guid]::NewGuid().ToString('N')
  $jpgPromotionPath = Join-Path -Path $resolvedOutDir -ChildPath ".$sourceStem.$promotionId.jpg.partial"
  $stlPromotionPath = if (-not [string]::IsNullOrWhiteSpace($stlOutputPath)) {
    Join-Path -Path $resolvedOutDir -ChildPath ".$sourceStem.$promotionId.stl.partial"
  } else { '' }

  Write-Output '[edrawings-native] automation=EDrawingOfficeAutomator.Document'
  Write-Output "[edrawings-native] source=$resolvedInput"
  Write-Output "[edrawings-native] mode=$Mode"
  Write-ExporterStage 'office-automator:start'
  $officeDocument = New-Object -ComObject 'EDrawingOfficeAutomator.Document'
  $viewer = $officeDocument.GetViewerControl()
  $eventSubscription = Connect-EDrawingsEventBridge -Viewer $viewer -Bridge (Initialize-EDrawingsEventBridge)
  $viewer.FullUI = 0
  $viewer.BackgroundColorOverride = $true
  $viewer.BackgroundColorGradient = $false
  # Blanco puro en fondo y papel: el default pinta un marco azul-gris y una
  # hoja gris claro que en la impresora del taller sale como un lavado de toner.
  try { $viewer.BackgroundColor = 0xFFFFFF } catch { }
  try {
    $viewer.PaperColorOverride = $true
    $viewer.PaperColor = 0xFFFFFF
  } catch { }
  [SmvVisionEDrawingsEventBridge]::ResetLoad()
  $viewer.OpenDoc($resolvedInput, $false, $false, $true, '')
  Wait-EDrawingsEvent -Operation load -TimeoutMilliseconds ($TimeoutSeconds * 1000)

  # Ampliar ANTES de orientar: al cambiar el tamano del viewport eDrawings
  # reencuadra la vista, asi que orientar despues deja el encuadre correcto.
  if (-not $NoFullScreen) {
    try {
      $viewer.ShowFullScreen($true)
      $script:FullScreenActive = $true
      Start-Sleep -Milliseconds 1200
    } catch {
      Write-ExporterStage "fullscreen:unavailable:$($_.Exception.Message)"
    }
  }

  if ($Mode -eq 'iso') {
    $viewer.ViewOrientation = 6
    $viewer.ViewOrientation = 7
  } else {
    try { $viewer.ZoomToFit() } catch { }
  }
  $viewer.ShowShadedEdges = $true
  $viewer.UpdateScene()
  Start-Sleep -Milliseconds 600
  # Width/Height no se refrescan tras ShowFullScreen (getters cacheados del
  # control), asi que no sirven como diagnostico: el tamano real solo se
  # conoce del JPG ya escrito. Reportamos la bandera, no dimensiones falsas.
  Write-ExporterStage "fullscreen:$(if ($script:FullScreenActive) { 'on' } else { 'off' })"
  Write-ExporterStage 'jpg-save:start'
  [SmvVisionEDrawingsEventBridge]::ResetSave()
  $viewer.Save($stagedJpgPath, $false, '')
  Wait-EDrawingsEvent -Operation save -TimeoutMilliseconds ($TimeoutSeconds * 1000)
  $jpgInfo = Get-Item -LiteralPath $stagedJpgPath -ErrorAction Stop
  if ($jpgInfo.Length -le 0) { throw 'eDrawings confirmo el JPG pero el archivo quedo vacio.' }
  $jpgInfo = Promote-Artifact -StagedPath $stagedJpgPath -PromotionPath $jpgPromotionPath -OutputPath $jpgOutputPath
  Write-ExporterStage "jpg:ready:$($jpgInfo.Length)"

  if (-not [string]::IsNullOrWhiteSpace($stlOutputPath)) {
    Write-ExporterStage 'stl-save:start'
    [SmvVisionEDrawingsEventBridge]::ResetSave()
    $viewer.Save($stagedStlPath, $false, '')
    try {
      Wait-EDrawingsEvent -Operation save -TimeoutMilliseconds 30000
      $stlInfo = Get-Item -LiteralPath $stagedStlPath -ErrorAction Stop
    } catch {
      $stlInfo = $null
    }
    if ($null -ne $stlInfo -and $stlInfo.Length -gt 0 -and (Test-ValidBinaryStl -Path $stagedStlPath)) {
      $stlInfo = Promote-Artifact -StagedPath $stagedStlPath -PromotionPath $stlPromotionPath -OutputPath $stlOutputPath -ValidateBinaryStl
      Write-ExporterStage "stl:ready:$($stlInfo.Length)"
    } else {
      Write-ExporterStage 'stl:optional-unavailable'
    }
  }
  Write-ExporterStage 'office-automator:complete'
} catch {
  [Console]::Error.WriteLine("[edrawings-native] $($_.Exception.Message)")
  [Console]::Error.Flush()
  if ($script:ExitCode -eq 0) { $script:ExitCode = 2 }
} finally {
  Disconnect-EDrawingsEventBridge -Subscription $eventSubscription
  if ($null -ne $viewer) {
    if ($script:FullScreenActive) { try { $viewer.ShowFullScreen($false) } catch { } }
    try { $viewer.CloseActiveDoc('') } catch { }
    try { [void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($viewer) } catch { }
  }
  if ($null -ne $officeDocument) {
    try { [void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($officeDocument) } catch { }
  }
  foreach ($partialPath in @($jpgPromotionPath, $stlPromotionPath)) {
    try {
      if ([string]::IsNullOrWhiteSpace($partialPath) -or
          [string]::IsNullOrWhiteSpace($resolvedOutDir)) { continue }
      $resolvedPartialPath = [IO.Path]::GetFullPath($partialPath)
      $partialParent = [IO.Path]::GetDirectoryName($resolvedPartialPath)
      $partialName = [IO.Path]::GetFileName($resolvedPartialPath)
      if ($partialParent.Equals($resolvedOutDir, [StringComparison]::OrdinalIgnoreCase) -and
          $partialName.EndsWith('.partial', [StringComparison]::OrdinalIgnoreCase) -and
          (Test-Path -LiteralPath $resolvedPartialPath -PathType Leaf)) {
        Remove-Item -LiteralPath $resolvedPartialPath -Force
      }
    } catch { }
  }
  if (-not [string]::IsNullOrWhiteSpace($stagingDirectory)) {
    try {
      $resolvedTempRoot = [IO.Path]::GetFullPath([IO.Path]::GetTempPath()).TrimEnd('\') + '\'
      $resolvedStagingDirectory = [IO.Path]::GetFullPath($stagingDirectory)
      if ($resolvedStagingDirectory.StartsWith($resolvedTempRoot, [StringComparison]::OrdinalIgnoreCase) -and
          ([IO.Path]::GetFileName($resolvedStagingDirectory) -like 'smv-vision-edrawings-*')) {
        Remove-Item -LiteralPath $resolvedStagingDirectory -Recurse -Force
      }
    } catch {
      Write-Warning "No se pudo limpiar la etapa temporal: $($_.Exception.Message)"
    }
  }
}

exit $script:ExitCode
