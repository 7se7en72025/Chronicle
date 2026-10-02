$ErrorActionPreference = 'Stop'
$taskName = 'Chronicle Autonomous Review'
$stateRoot = if ($env:CHRONICLE_RUNNER_STATE) { $env:CHRONICLE_RUNNER_STATE } else { Join-Path $env:LOCALAPPDATA 'Chronicle\runner' }
$stopPath = Join-Path $stateRoot 'STOP'
[System.IO.Directory]::CreateDirectory($stateRoot) | Out-Null
[System.IO.File]::WriteAllText($stopPath, "Stopped by user at $([DateTime]::UtcNow.ToString('s'))Z`n")
$task = Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
if ($task) {
    if ($task.State -eq 'Running') {
        Write-Output "Stop requested. The active model cycle will finish (or reach its timeout) before exiting. Run this script again after the task is Ready to remove its schedule."
        exit 0
    }
    Unregister-ScheduledTask -TaskName $taskName -Confirm:$false
    Write-Output "Stopped and removed '$taskName'. Runner logs remain in $stateRoot."
} else {
    Write-Output "No '$taskName' task was registered. The stop marker remains in $stateRoot."
}
