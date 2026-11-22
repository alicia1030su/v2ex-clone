[CmdletBinding()]
param(
  [ValidateSet('Snapshot', 'Serve')]
  [string]$Mode = 'Snapshot',

  [ValidateRange(0, 2147483647)]
  [int]$ProcessId = 0
)

$ErrorActionPreference = 'Stop'
[Console]::InputEncoding = [System.Text.Encoding]::UTF8
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

$script:ProcessProperties = @(
  'ProcessId',
  'ParentProcessId',
  'Name',
  'ExecutablePath',
  'CreationDate',
  'WorkingSetSize'
)

function Get-WorkBuddyProcessRows {
  param([int]$TargetProcessId = 0)

  # Exact PID identity fencing uses CIM. It is called only at bind/cleanup
  # boundaries. Full-tree sampling uses the same Win32_Process schema through
  # the local WMI provider, which is substantially faster inside an already
  # running PowerShell host and keeps the 1 Hz cadence achievable.
  if ($TargetProcessId -gt 0) {
    return @(Get-CimInstance -ClassName 'Win32_Process' -Filter "ProcessId=$TargetProcessId" -Property $script:ProcessProperties)
  }
  return @(Get-WmiObject -Class 'Win32_Process' -Property $script:ProcessProperties)
}

function Get-WorkBuddyFastProcessRow {
  param([int]$TargetProcessId, [int]$ParentProcessId)

  # Get-Process is dramatically faster than CIM for the spawn -> lease bind
  # window. The supervisor already knows this is its direct child, so PPID is
  # authoritative; cleanup still revalidates with full CIM identity.
  $process = Get-Process -Id $TargetProcessId -ErrorAction Stop
  $executable = $null
  try { $executable = $process.MainModule.FileName } catch { }
  return [pscustomobject]@{
    ProcessId = [uint32]$process.Id
    ParentProcessId = [uint32]$ParentProcessId
    Name = [string]$process.ProcessName
    ExecutablePath = $executable
    CreationDate = $process.StartTime.ToUniversalTime()
    WorkingSetSize = [uint64]$process.WorkingSet64
  }
}

function ConvertTo-WorkBuddySnapshot {
  param([object[]]$Processes)

  $rows = @($Processes | ForEach-Object {
    $creation = $null
    if ($null -ne $_.CreationDate) {
      if ($_.CreationDate -is [datetime]) {
        $creation = $_.CreationDate.ToUniversalTime().ToString('o')
      } else {
        $creation = [Management.ManagementDateTimeConverter]::ToDateTime(
          [string]$_.CreationDate
        ).ToUniversalTime().ToString('o')
      }
    }
    [pscustomobject]@{
      ProcessId = [uint32]$_.ProcessId
      ParentProcessId = [uint32]$_.ParentProcessId
      Name = [string]$_.Name
      ExecutablePath = if ($null -eq $_.ExecutablePath) { $null } else { [string]$_.ExecutablePath }
      CreationDate = $creation
      WorkingSetSize = [uint64]$_.WorkingSetSize
    }
  })

  return [pscustomobject]@{
    schema = 'workbuddy-dev-memory/process-table-windows/v1'
    mode = 'Snapshot'
    processes = $rows
  }
}

if ($Mode -eq 'Serve') {
  # Long-lived host: avoids paying ~800 ms PowerShell startup on every sample.
  # Protocol is newline-delimited requests: "all", a decimal PID, or "__exit__".
  [Console]::Out.WriteLine('READY')
  [Console]::Out.Flush()
  while ($true) {
    $request = [Console]::In.ReadLine()
    if ($null -eq $request) { break }
    if ($request -eq '__exit__') { break }

    try {
      $targetPid = 0
      $parentPid = 0
      $fast = $false
      if ($request -like 'fast:*') {
        $parts = $request.Split(':')
        if ($parts.Length -ne 3 -or
            -not [int]::TryParse($parts[1], [ref]$targetPid) -or
            -not [int]::TryParse($parts[2], [ref]$parentPid)) {
          throw "invalid fast process-table request: $request"
        }
        $fast = $true
      } elseif ($request -ne 'all') {
        if (-not [int]::TryParse($request, [ref]$targetPid)) {
          throw "invalid process-table request: $request"
        }
      }
      if ($fast) {
        $snapshot = ConvertTo-WorkBuddySnapshot -Processes @(Get-WorkBuddyFastProcessRow -TargetProcessId $targetPid -ParentProcessId $parentPid)
      } else {
        $snapshot = ConvertTo-WorkBuddySnapshot -Processes (Get-WorkBuddyProcessRows -TargetProcessId $targetPid)
      }
      [Console]::Out.WriteLine(($snapshot | ConvertTo-Json -Compress -Depth 6))
    } catch {
      $failure = [pscustomobject]@{
        schema = 'workbuddy-dev-memory/process-table-windows/v1'
        error = $_.Exception.Message
        processes = @()
      }
      [Console]::Out.WriteLine(($failure | ConvertTo-Json -Compress -Depth 6))
    }
    [Console]::Out.Flush()
  }
  exit 0
}

$snapshot = ConvertTo-WorkBuddySnapshot -Processes (Get-WorkBuddyProcessRows -TargetProcessId $ProcessId)
$snapshot | ConvertTo-Json -Compress -Depth 6
