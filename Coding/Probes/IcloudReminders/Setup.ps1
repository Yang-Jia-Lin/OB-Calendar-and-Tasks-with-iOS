$ErrorActionPreference = 'Stop'
$workspace = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..\..'))
$output = Join-Path $workspace 'Results\Probes\IcloudReminders'
$commit = 'af5246511c729eee4d5a95671135ad75fdd77b22'
$hash = '88B26BF63F875669874C8E0D4BF4F81DEFC654D779A862218BA72FC98181CCB8'
$archive = Join-Path $output 'pyicloud-source.zip'
$source = Join-Path $output "upstream\pyicloud-$commit"
$python = Join-Path $output '.venv\Scripts\python.exe'
New-Item -ItemType Directory -Path $output -Force | Out-Null
if (-not (Test-Path -LiteralPath $source)) {
    if (-not (Test-Path -LiteralPath $archive)) {
        Invoke-WebRequest -Uri "https://codeload.github.com/timlaing/pyicloud/zip/$commit" -OutFile $archive
    }
    if ((Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash -ne $hash) { throw 'Upstream archive checksum mismatch.' }
    Expand-Archive -LiteralPath $archive -DestinationPath (Join-Path $output 'upstream')
}
if (-not (Test-Path -LiteralPath $python)) {
    & py -3.13 -m venv (Join-Path $output '.venv')
    if ($LASTEXITCODE -ne 0) { throw 'Python 3.13 environment creation failed.' }
}
& $python -m pip install -r (Join-Path $PSScriptRoot 'requirements.lock.txt')
if ($LASTEXITCODE -ne 0) { throw 'Locked dependency installation failed.' }
& $python (Join-Path $PSScriptRoot 'probe.py') --preflight
if ($LASTEXITCODE -ne 0) { throw 'Offline preflight failed.' }
Write-Output 'Probe dependencies prepared. No account login or cloud writes performed.'
