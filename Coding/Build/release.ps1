param(
    [ValidateSet('', 'preview', 'stable')][string]$Channel = '',
    [string]$VaultPath = 'D:\笔记',
    [switch]$NoInstall
)
$ErrorActionPreference = 'Stop'
$workspace = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..'))
$coding = Join-Path $workspace 'Coding'
$manifest = Get-Content -Raw -LiteralPath (Join-Path $coding 'Clients\Obsidian\manifest.json') | ConvertFrom-Json
if ($manifest.version -notmatch '^\d+\.\d+\.\d+$') { throw 'Invalid plugin version.' }
$artifact = "V{0}_calendar-task-timer" -f $manifest.version
if ($Channel) { $artifact += "_$Channel" }
$release = Join-Path $workspace 'Results\Obsidian'
$plugin = Join-Path $release $artifact
$previousChannel = $env:CTT_RELEASE_CHANNEL
Push-Location $coding
try {
    $env:CTT_RELEASE_CHANNEL = $Channel
    & npm.cmd run build
    if ($LASTEXITCODE -ne 0) { throw 'Build failed.' }
} finally {
    $env:CTT_RELEASE_CHANNEL = $previousChannel
    Pop-Location
}
$builtManifest = Get-Content -Raw -LiteralPath (Join-Path $plugin 'manifest.json') | ConvertFrom-Json
if ($builtManifest.version -ne $manifest.version -or $builtManifest.id -ne 'calendar-task-timer') { throw 'Built plugin identity or version mismatch.' }
$expected = @('main.js', 'manifest.json', 'styles.css')
$files = @(Get-ChildItem -LiteralPath $plugin -Force)
if ($files.Count -ne 3 -or @($files | Where-Object { $_.PSIsContainer -or $_.Name -notin $expected }).Count) { throw 'Release must contain exactly three plugin files.' }
& node --check (Join-Path $plugin 'main.js')
if ($LASTEXITCODE -ne 0) { throw 'Built plugin JavaScript syntax check failed.' }
Write-Output "Release folder: $plugin"
if ($NoInstall) { return }

$vault = (Resolve-Path -LiteralPath $VaultPath).Path
$obsidian = Join-Path $vault '.obsidian'
if (-not (Test-Path -LiteralPath $obsidian -PathType Container)) { throw 'The selected vault has no .obsidian directory. Release was built but not installed.' }
$destination = Join-Path $obsidian 'plugins\calendar-task-timer'
$installedManifest = Join-Path $destination 'manifest.json'
if ((Test-Path -LiteralPath $installedManifest) -and (Get-Content -Raw -LiteralPath $installedManifest | ConvertFrom-Json).id -ne 'calendar-task-timer') { throw 'Installed plugin ID mismatch; refusing to overwrite.' }

$changed = @($expected | Where-Object {
    $installed = Join-Path $destination $_
    -not (Test-Path -LiteralPath $installed -PathType Leaf) -or (Get-FileHash -LiteralPath $installed -Algorithm SHA256).Hash -ne (Get-FileHash -LiteralPath (Join-Path $plugin $_) -Algorithm SHA256).Hash
})
if ($changed.Count -and (Test-Path -LiteralPath $destination)) {
    $backup = Join-Path $workspace ('Agents\Backups\Before-Install-{0}' -f (Get-Date -Format 'yyyyMMdd-HHmmss-ffff'))
    New-Item -ItemType Directory -Path $backup | Out-Null
    foreach ($name in $expected) {
        $installed = Join-Path $destination $name
        if (Test-Path -LiteralPath $installed -PathType Leaf) { Copy-Item -LiteralPath $installed -Destination (Join-Path $backup $name) }
    }
    Write-Output "Previous plugin files: $backup"
}
New-Item -ItemType Directory -Path $destination -Force | Out-Null
foreach ($name in $expected) {
    $source = Join-Path $plugin $name
    $target = Join-Path $destination $name
    Copy-Item -LiteralPath $source -Destination $target -Force
    if ((Get-FileHash -LiteralPath $source -Algorithm SHA256).Hash -ne (Get-FileHash -LiteralPath $target -Algorithm SHA256).Hash) { throw "Installed file verification failed: $name" }
}
Write-Output "Installed three plugin files to: $destination"
Write-Output 'Settings, sessions and migration files were preserved. The running plugin was not reloaded.'
