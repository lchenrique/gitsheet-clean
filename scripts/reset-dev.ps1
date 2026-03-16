$ErrorActionPreference = "Stop"

$projectPath = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$escapedProjectPath = [Regex]::Escape($projectPath)

$processes = Get-CimInstance Win32_Process |
  Where-Object {
    $_.Name -eq "node.exe" -and
    $_.CommandLine -match "next(?:\.js)?[/\\]dist[/\\]bin[/\\]next.*\bdev\b" -and
    $_.CommandLine -match $escapedProjectPath
  }

if ($processes) {
  $processes | ForEach-Object {
    Write-Host "Encerrando processo Next antigo: $($_.ProcessId)"
    Stop-Process -Id $_.ProcessId -Force
  }

  Start-Sleep -Milliseconds 500
}

$pathsToRemove = @(
  (Join-Path $projectPath ".next"),
  (Join-Path $projectPath "node_modules\.cache")
)

foreach ($path in $pathsToRemove) {
  if (Test-Path $path) {
    Write-Host "Limpando $path"
    Remove-Item $path -Recurse -Force
  }
}

Write-Host "Iniciando Next limpo em $projectPath"
& node (Join-Path $projectPath "scripts/start-dev.mjs")
