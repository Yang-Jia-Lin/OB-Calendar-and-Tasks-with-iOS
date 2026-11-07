param([string]$PythonDependencies = '', [string]$SdkSource = '')
$ErrorActionPreference = 'Stop'
$codingRoot = Split-Path $PSScriptRoot -Parent
$projectRoot = Split-Path $codingRoot -Parent
$resourceRoot = Join-Path $projectRoot 'Agents/Tests/Desktop/resources'
$runtimeRoot = Join-Path $resourceRoot 'runtime'
New-Item -ItemType Directory -Path $runtimeRoot -Force | Out-Null
if (-not $PythonDependencies) { $PythonDependencies = Join-Path $projectRoot 'Results/Probes/IcloudReminders/.venv/Lib/site-packages' }
if (-not $SdkSource) { $SdkSource = Join-Path $projectRoot 'Results/Probes/IcloudReminders/upstream/pyicloud-af5246511c729eee4d5a95671135ad75fdd77b22/pyicloud' }
if (-not (Test-Path -LiteralPath $PythonDependencies) -or -not (Test-Path -LiteralPath $SdkSource)) { throw 'Need the pinned SDK and a Python 3.13 dependency set; never copy account/session directories.' }
$nodeExe = (Get-Command node).Source
if ((& $nodeExe -p 'process.versions.node') -ne '24.14.0') { throw 'Pinned desktop Node runtime is 24.14.0.' }
Copy-Item -LiteralPath $nodeExe -Destination (Join-Path $runtimeRoot 'node.exe') -Force
$pythonZip = Join-Path $projectRoot 'Agents/Tests/Desktop/python-3.13.5-embed-amd64.zip'
if (-not (Test-Path -LiteralPath $pythonZip)) { Invoke-WebRequest -Uri 'https://www.python.org/ftp/python/3.13.5/python-3.13.5-embed-amd64.zip' -OutFile $pythonZip -TimeoutSec 90 }
$pythonRoot = Join-Path $runtimeRoot 'python'
Expand-Archive -LiteralPath $pythonZip -DestinationPath $pythonRoot -Force
$signature = Get-AuthenticodeSignature -LiteralPath (Join-Path $pythonRoot 'python.exe')
if ($signature.Status -ne 'Valid' -or $signature.SignerCertificate.Subject -notmatch 'Python Software Foundation') { throw 'Embedded Python signature invalid.' }
# Only SDK source and dependency code are copied. No .private, cookie, keyring, or application data directory.
$siteRoot = Join-Path $pythonRoot 'Lib/site-packages'
New-Item -ItemType Directory -Path $siteRoot -Force | Out-Null
Get-ChildItem -LiteralPath $PythonDependencies | Where-Object { $_.Name -notmatch '^(pip|setuptools|__pycache__)(-|$|\.)' } | ForEach-Object { Copy-Item -LiteralPath $_.FullName -Destination $siteRoot -Recurse -Force }
$sdkRoot = Join-Path $runtimeRoot 'sdk/pyicloud'
New-Item -ItemType Directory -Path $sdkRoot -Force | Out-Null
Get-ChildItem -LiteralPath $SdkSource | Where-Object Name -NE '__pycache__' | ForEach-Object { Copy-Item -LiteralPath $_.FullName -Destination $sdkRoot -Recurse -Force }
@('python313.zip','.','Lib/site-packages','../sdk','import site') | Set-Content -LiteralPath (Join-Path $pythonRoot 'python313._pth') -Encoding utf8
$env:CTT_RUNTIME_REQUIREMENTS = Join-Path $codingRoot 'Probes/IcloudReminders/requirements.lock.txt'
& (Join-Path $pythonRoot 'python.exe') -c 'import os,importlib.metadata as m; from pathlib import Path; locks=Path(os.environ["CTT_RUNTIME_REQUIREMENTS"]).read_text().splitlines(); mismatches=[x for x in locks if x and m.version(x.split("==")[0])!=x.split("==")[1]]; assert not mismatches,mismatches; import pyicloud,cryptography,requests,zoneinfo; print("Embedded Python and pinned reminder dependencies verified")'
if ($LASTEXITCODE -ne 0) { throw 'Packaged Python dependency check failed.' }
Copy-Item -LiteralPath (Join-Path $codingRoot 'Probes/IcloudReminders/requirements.lock.txt') -Destination (Join-Path $resourceRoot 'requirements.lock.txt') -Force
$hashes = Get-ChildItem -LiteralPath $resourceRoot -Recurse -File | ForEach-Object { [PSCustomObject]@{path=[IO.Path]::GetRelativePath($resourceRoot,$_.FullName);sha256=(Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash} }
$hashes | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath (Join-Path $projectRoot 'Agents/Tests/Desktop/runtime-hashes.json') -Encoding utf8
Write-Output 'Packaged runtimes verified. Normal application startup performs no dependency installation.'
