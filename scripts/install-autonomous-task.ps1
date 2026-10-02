$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent $PSScriptRoot
$runnerPath = Join-Path $PSScriptRoot 'run-autonomous.ps1'
$taskName = 'Chronicle Autonomous Review'
$codex = Get-Command codex -ErrorAction SilentlyContinue
if (-not $codex) {
    throw 'Codex CLI was not found on PATH. Install it and complete codex login before registering the background task.'
}
& $codex.Source login status | Out-Null
if ($LASTEXITCODE -ne 0) {
    throw 'Codex CLI is not logged in for this Windows user. Run codex login before registering the background task.'
}

$powerShell = Join-Path $PSHOME 'powershell.exe'
$principalId = "$env:USERDOMAIN\$env:USERNAME"
$action = New-ScheduledTaskAction -Execute $powerShell -Argument "-NoProfile -NonInteractive -ExecutionPolicy Bypass -File `"$runnerPath`"" -WorkingDirectory $repoRoot
$trigger = New-ScheduledTaskTrigger -AtLogOn -User $principalId
$principal = New-ScheduledTaskPrincipal -UserId $principalId -LogonType Interactive -RunLevel Limited
$settings = New-ScheduledTaskSettingsSet -MultipleInstances IgnoreNew -ExecutionTimeLimit (New-TimeSpan -Seconds 0) -StartWhenAvailable -DisallowStartIfOnBatteries
Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Principal $principal -Settings $settings -Description 'Runs bounded, local Chronicle review cycles while this Windows user is logged in.' -Force | Out-Null
Start-ScheduledTask -TaskName $taskName
Write-Output "Registered and started '$taskName'. It runs only in this user session and uses Codex model usage."
