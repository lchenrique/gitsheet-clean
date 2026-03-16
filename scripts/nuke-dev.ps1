$ErrorActionPreference = "Stop"

$projectPath = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$escapedProjectPath = [Regex]::Escape($projectPath)

$processes = Get-CimInstance Win32_Process |
  Where-Object {
    $_.Name -eq "node.exe" -and
    $_.CommandLine -match $escapedProjectPath
  }

if ($processes) {
  $processes | ForEach-Object {
    Write-Host "Encerrando processo Node antigo: $($_.ProcessId)"
    Stop-Process -Id $_.ProcessId -Force
  }

  Start-Sleep -Milliseconds 800
}

$pathsToRemove = @(
  (Join-Path $projectPath ".next"),
  (Join-Path $projectPath "node_modules"),
  (Join-Path $projectPath "node_modules\.cache")
)

foreach ($path in $pathsToRemove) {
  if (Test-Path $path) {
    Write-Host "Removendo $path"
    Remove-Item $path -Recurse -Force
  }
}

Write-Host "Reinstalando dependencias"
Push-Location $projectPath
try {
  & npm install
  if ($LASTEXITCODE -ne 0) {
    throw "npm install falhou."
  }

  Write-Host "Iniciando Next apos reinstalacao"
  & node (Join-Path $projectPath "scripts/start-dev.mjs")
} finally {
  Pop-Location
}
