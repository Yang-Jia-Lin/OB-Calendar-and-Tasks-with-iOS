param([switch]$PrepareOnly, [switch]$Browser, [switch]$Resume)
$ErrorActionPreference = 'Stop'
$workspace = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..\..'))
$probeOutput = Join-Path $workspace 'Results\Probes\IcloudReminders'
$privatePath = Join-Path $probeOutput '.private'
$pythonPath = Join-Path $probeOutput '.venv\Scripts\python.exe'
if (-not (Test-Path -LiteralPath $pythonPath)) { throw 'Missing isolated Python environment.' }
New-Item -ItemType Directory -Path $privatePath -Force | Out-Null
# Protect cookies/manifests before the library can create anything in this tree.
$identity = [System.Security.Principal.WindowsIdentity]::GetCurrent().User
$acl = [System.Security.AccessControl.DirectorySecurity]::new()
$acl.SetOwner($identity)
$acl.SetAccessRuleProtection($true, $false)
$inheritance = [System.Security.AccessControl.InheritanceFlags]'ContainerInherit,ObjectInherit'
$propagation = [System.Security.AccessControl.PropagationFlags]::None
foreach ($sid in @($identity, [System.Security.Principal.SecurityIdentifier]::new('S-1-5-18'))) {
    $rule = [System.Security.AccessControl.FileSystemAccessRule]::new($sid, 'FullControl', $inheritance, $propagation, 'Allow')
    $acl.AddAccessRule($rule)
}
Set-Acl -LiteralPath $privatePath -AclObject $acl
if ($PrepareOnly) {
    Write-Output 'Private session directory ACL prepared; no authentication attempted.'
    return
}
$env:PYTHONUTF8 = '1'
$entryPoint = if ($Browser) { 'local_ui.py' } elseif ($Resume) { 'resume_probe.py' } else { 'probe.py' }
$probeArguments = @()
if ($Browser -and $Resume) { $probeArguments += '--resume' }
& $pythonPath (Join-Path $PSScriptRoot $entryPoint) @probeArguments
if ($LASTEXITCODE -ne 0) { Write-Host 'Probe stopped before completion.' }
Read-Host '按 Enter 关闭测试窗口'
