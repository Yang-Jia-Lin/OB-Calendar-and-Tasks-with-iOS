$ErrorActionPreference = 'Stop'
$workspace = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..'))
$coding = Join-Path $workspace 'Coding'
Push-Location $coding
try {
    & npm.cmd run build
    if ($LASTEXITCODE -ne 0) { throw 'Build failed.' }
} finally { Pop-Location }
$plugin = Join-Path $workspace 'Plugin\calendar-task-timer'
$manifest = Get-Content -Raw -LiteralPath (Join-Path $plugin 'manifest.json') | ConvertFrom-Json
$expected = @('main.js', 'manifest.json', 'styles.css')
$files = @(Get-ChildItem -LiteralPath $plugin -Force)
if ($files.Count -ne 3 -or @($files | Where-Object { $_.PSIsContainer -or $_.Name -notin $expected }).Count) { throw 'Release must contain exactly three plugin files.' }
$release = Join-Path $workspace 'Results\Release'
New-Item -ItemType Directory -Path $release -Force | Out-Null
$destination = Join-Path $release ("calendar-task-timer-{0}.zip" -f $manifest.version)
Compress-Archive -LiteralPath $plugin -DestinationPath $destination -Force
Write-Output $destination
