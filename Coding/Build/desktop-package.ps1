param([switch]$NoBundle)
$ErrorActionPreference = 'Stop'
$codingRoot = Split-Path $PSScriptRoot -Parent
$projectRoot = Split-Path $codingRoot -Parent
$toolsRoot = Join-Path $projectRoot 'Agents/Tests/toolchains'
$env:RUSTUP_HOME = Join-Path $toolsRoot 'rustup'
$env:CARGO_HOME = Join-Path $toolsRoot 'cargo'
$env:CARGO_TARGET_DIR = Join-Path $projectRoot 'Agents/Tests/Desktop/target'
$env:PATH = (Join-Path $env:CARGO_HOME 'bin') + ';' + $env:PATH
$portable = Join-Path $toolsRoot 'msvc'
if (Test-Path -LiteralPath $portable) {
  $vc = Get-ChildItem -LiteralPath (Join-Path $portable 'VC/Tools/MSVC') -Directory | Sort-Object Name -Descending | Select-Object -First 1
  $sdk = Get-ChildItem -LiteralPath (Join-Path $portable 'Windows Kits/10/Include') -Directory | Sort-Object Name -Descending | Select-Object -First 1
  if (-not $vc -or -not $sdk) { throw 'Portable MSVC/SDK is incomplete.' }
  $env:PATH = (Join-Path $vc.FullName 'bin/Hostx64/x64') + ';' + (Join-Path $portable ('Windows Kits/10/bin/' + $sdk.Name + '/x64')) + ';' + $env:PATH
  $env:INCLUDE = (Join-Path $vc.FullName 'include') + ';' + (Join-Path $sdk.FullName 'ucrt') + ';' + (Join-Path $sdk.FullName 'shared') + ';' + (Join-Path $sdk.FullName 'um') + ';' + (Join-Path $sdk.FullName 'winrt')
  $env:LIB = (Join-Path $vc.FullName 'lib/x64') + ';' + (Join-Path $portable ('Windows Kits/10/Lib/' + $sdk.Name + '/ucrt/x64')) + ';' + (Join-Path $portable ('Windows Kits/10/Lib/' + $sdk.Name + '/um/x64'))
}
Push-Location $codingRoot
try {
  & node Build/desktop-build.mjs
  if ($LASTEXITCODE -ne 0) { throw 'Desktop asset build failed.' }
  if (-not (Test-Path -LiteralPath (Join-Path $projectRoot 'Agents/Tests/Desktop/resources/runtime/python/python.exe'))) { & (Join-Path $PSScriptRoot 'desktop-runtime.ps1') }
  & node Build/desktop-licenses.mjs
  if ($LASTEXITCODE -ne 0) { throw 'Desktop license collection failed.' }
  Push-Location (Join-Path $codingRoot 'Clients/Desktop/native')
  try { $arguments = @((Join-Path $codingRoot 'node_modules/@tauri-apps/cli/tauri.js'),'build'); if($NoBundle){$arguments += '--no-bundle'}; & node @arguments; if($LASTEXITCODE -ne 0){throw 'Native desktop build failed.'} }
  finally { Pop-Location }
}
finally { Pop-Location }
