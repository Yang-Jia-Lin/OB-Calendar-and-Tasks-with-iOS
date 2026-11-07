param([int]$Seconds=10,[string]$Label='main-open')
$ErrorActionPreference='Stop'
$projectRoot=Split-Path (Split-Path $PSScriptRoot -Parent) -Parent
$profile=Get-Content -Raw -LiteralPath (Join-Path $projectRoot 'Agents/Tests/Desktop/native-test-profile.json') | ConvertFrom-Json
$expected=[IO.Path]::GetFullPath((Join-Path $projectRoot 'Agents/Tests/Desktop/target/release/calendar-task-timer-desktop.exe'))
if((Get-Process -Id $profile.pid).Path -ne $expected){throw 'Refusing to profile an unrelated application.'}
function Read-TestTree {
  $pendingIds=[Collections.Generic.Queue[int]]::new();$pendingIds.Enqueue([int]$profile.pid)
  $seen=[Collections.Generic.HashSet[int]]::new()
  while($pendingIds.Count){$currentId=$pendingIds.Dequeue();if(-not $seen.Add($currentId)){continue};$parentProcess=Get-Process -Id $currentId -ErrorAction SilentlyContinue;if(-not $parentProcess){continue};Get-CimInstance Win32_Process -Filter "ParentProcessId=$currentId" | Where-Object CreationDate -ge $parentProcess.StartTime | ForEach-Object {$pendingIds.Enqueue([int]$_.ProcessId)}}
  $seen | ForEach-Object {Get-Process -Id $_ -ErrorAction SilentlyContinue}
}
$initial=Read-TestTree
$initialCpu=($initial | Measure-Object CPU -Sum).Sum
$watch=[Diagnostics.Stopwatch]::StartNew()
Start-Sleep -Seconds $Seconds
$final=Read-TestTree
$finalCpu=($final | Measure-Object CPU -Sum).Sum
$privateBytes=($final | Measure-Object PrivateMemorySize64 -Sum).Sum
$cpu=100*($finalCpu-$initialCpu)/$watch.Elapsed.TotalSeconds
$data=[PSCustomObject]@{mode=$Label;seconds=[Math]::Round($watch.Elapsed.TotalSeconds,2);processes=$final.Count;privateMB=[Math]::Round($privateBytes/1MB,1);cpuPercentMachine=[Math]::Round($cpu/[Environment]::ProcessorCount,3);cpuPercentSingleCore=[Math]::Round($cpu,3);pythonIncluded=[bool]($final | Where-Object ProcessName -Match '^python');notes='Isolated Windows native host and all current descendants; offline sample, no real iCloud account.'}
$data | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $projectRoot ('Agents/Tests/Desktop/native-metrics-'+$Label+'.json')) -Encoding utf8
$data | ConvertTo-Json -Compress
