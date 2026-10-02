param(
    [switch]$Once,
    [switch]$Worker,
    [string]$CodexCommand = 'codex',
    [string]$ExpectedOrigin = 'https://github.com/7se7en72025/Chronicle.git',
    [string]$CodexPath,
    [string]$PromptPath,
    [string]$RunLogPath,
    [string]$SummaryPath,
    [int]$IntervalMinutes = 30,
    [int]$MaxRunMinutes = 25
)

$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent $PSScriptRoot

if ($Worker) {
    try {
        $env:CHRONICLE_AUTONOMOUS_PROMPT = [System.IO.File]::ReadAllText($PromptPath)
        Push-Location $repoRoot
        try {
            $previousErrorAction = $ErrorActionPreference
            $ErrorActionPreference = 'Continue'
            $logWriter = New-Object System.IO.StreamWriter($RunLogPath, $false, (New-Object System.Text.UTF8Encoding($false)))
            try {
                & $CodexPath exec --sandbox workspace-write --config approval_policy=never --config sandbox_workspace_write.network_access=false --ephemeral --json --output-last-message $SummaryPath $env:CHRONICLE_AUTONOMOUS_PROMPT 2>&1 | ForEach-Object { $logWriter.WriteLine([string]$_) }
                $codexExitCode = $LASTEXITCODE
            }
            finally {
                $logWriter.Dispose()
                $ErrorActionPreference = $previousErrorAction
            }
        }
        finally {
            Pop-Location
        }
        exit $codexExitCode
    }
    catch {
        [System.IO.File]::AppendAllText($RunLogPath, "`nWorker error: $($_.Exception.Message)`n")
        exit 1
    }
}

if ($IntervalMinutes -lt 1 -or $MaxRunMinutes -lt 1 -or $MaxRunMinutes -ge $IntervalMinutes) {
    throw 'Use positive intervals, with MaxRunMinutes shorter than IntervalMinutes.'
}

$stateRoot = if ($env:CHRONICLE_RUNNER_STATE) {
    $env:CHRONICLE_RUNNER_STATE
} else {
    Join-Path $env:LOCALAPPDATA 'Chronicle\runner'
}
[System.IO.Directory]::CreateDirectory($stateRoot) | Out-Null
$stopPath = Join-Path $stateRoot 'STOP'
$runnerLogPath = Join-Path $stateRoot 'runner.log'
$mutexHash = [System.BitConverter]::ToString([System.Security.Cryptography.SHA256]::Create().ComputeHash([System.Text.Encoding]::UTF8.GetBytes($repoRoot))).Replace('-', '').Substring(0, 24)
$mutex = New-Object System.Threading.Mutex($false, "Local\ChronicleRunner-$mutexHash")

function Write-RunnerLog([string]$Message) {
    $line = '{0} {1}{2}' -f [DateTime]::UtcNow.ToString('s'), $Message, [Environment]::NewLine
    [System.IO.File]::AppendAllText($runnerLogPath, $line, (New-Object System.Text.UTF8Encoding($false)))
}

function Get-RepositoryState {
    $status = @(& git -C $repoRoot status --porcelain=v1 --untracked-files=all 2>&1)
    if ($LASTEXITCODE -ne 0) { throw "Cannot inspect Git status: $($status -join ' ')" }
    $branch = (& git -C $repoRoot branch --show-current 2>&1 | Out-String).Trim()
    if ($LASTEXITCODE -ne 0) { throw 'Cannot inspect the current Git branch.' }
    $origin = (& git -C $repoRoot remote get-url origin 2>&1 | Out-String).Trim()
    if ($LASTEXITCODE -ne 0) { throw 'The origin remote is unavailable.' }
    $head = (& git -C $repoRoot rev-parse HEAD 2>&1 | Out-String).Trim()
    if ($LASTEXITCODE -ne 0) { throw 'Cannot inspect the current commit.' }
    $originMain = (& git -C $repoRoot rev-parse refs/remotes/origin/main 2>&1 | Out-String).Trim()
    if ($LASTEXITCODE -ne 0) { throw 'Cannot inspect cached origin/main; fetch or publish manually before resuming.' }
    $commitLine = (& git -C $repoRoot rev-list --parents -n 1 HEAD 2>&1 | Out-String).Trim()
    if ($LASTEXITCODE -ne 0) { throw 'Cannot inspect the current commit parent.' }
    $commitFields = $commitLine -split '\s+'
    $parent = if ($commitFields.Count -gt 1) { $commitFields[1] } else { '' }
    return [pscustomobject]@{ Status = $status; Branch = $branch; Origin = $origin; Head = $head; OriginMain = $originMain; Parent = $parent }
}

function Invoke-CodexCycle {
    $codexCommand = Get-Command $CodexCommand -ErrorAction Stop
    $codexExecutable = $codexCommand.Source
    if (-not $codexExecutable -and $CodexCommand -eq 'codex') {
        $npmShim = Join-Path $env:APPDATA 'npm\codex.cmd'
        if (Test-Path -LiteralPath $npmShim) {
            $codexExecutable = $npmShim
        }
    }
    if (-not $codexExecutable) { throw 'The codex command has no executable path.' }

    $runId = [DateTime]::UtcNow.ToString('yyyyMMdd-HHmmss-fff')
    $promptPath = Join-Path $stateRoot "$runId.prompt.txt"
    $runLogPath = Join-Path $stateRoot "$runId.jsonl"
    $summaryPath = Join-Path $stateRoot "$runId.summary.txt"
    $prompt = @'
Run one focused Chronicle review-and-improve cycle in this repository. First read AGENTS.md, HANDOFF.md, PLAN.md, ORCHESTRATION.md, REVIEW.md, upgrades.md, and learnings.md; inspect Git status and preserve existing work. Follow the highest-impact viable accepted queue item and current human instructions. Record evidence-based review findings, implement at most one meaningful queue task, run its relevant tests and checks, inspect the final diff in a second pass, and update the living documents accurately. Distinguish implemented, proposed, and verified claims. Do not access the network, force-push, deploy, publish, or perform destructive cleanup. The Codex process has network disabled. If and only if all authorized queue work is complete or concretely blocked, make no speculative edits and make the final response's first line exactly CHRONICLE_RUNNER_STOP. Otherwise, commit only the meaningful verified task on the existing main branch. The final response must contain a standalone line `CHRONICLE_RUNNER_READY <full-commit-hash>` only after tests, final diff review, documentation updates, and that single commit all succeed. Include a concise handoff and verification evidence.
'@
    [System.IO.File]::WriteAllText($promptPath, $prompt, (New-Object System.Text.UTF8Encoding($false)))

    $powerShellExe = Join-Path $PSHOME 'powershell.exe'
    $workerArgs = @(
        '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', (Join-Path $PSScriptRoot 'run-autonomous.ps1'),
        '-Worker', '-CodexPath', $codexExecutable, '-PromptPath', $promptPath, '-RunLogPath', $runLogPath, '-SummaryPath', $summaryPath
    )
    foreach ($workerArg in $workerArgs) {
        if ($workerArg.Contains('"')) { throw 'Runner paths and arguments cannot contain double quotes.' }
    }
    $argumentString = ($workerArgs | ForEach-Object { '"' + $_ + '"' }) -join ' '
    $startInfo = New-Object System.Diagnostics.ProcessStartInfo
    $startInfo.FileName = $powerShellExe
    $startInfo.Arguments = $argumentString
    $startInfo.WorkingDirectory = $repoRoot
    $startInfo.UseShellExecute = $false
    $startInfo.CreateNoWindow = $true

    $process = [System.Diagnostics.Process]::Start($startInfo)
    $limitMilliseconds = $MaxRunMinutes * 60 * 1000
    if (-not $process.WaitForExit($limitMilliseconds)) {
        Write-RunnerLog "Run $runId exceeded ${MaxRunMinutes}m; terminating its process tree."
        & taskkill.exe /PID $process.Id /T /F | Out-Null
        [System.IO.File]::WriteAllText($stopPath, "Timed out at $([DateTime]::UtcNow.ToString('s'))Z`n")
        return $false
    }
    $process.WaitForExit()

    if ($process.ExitCode -ne 0) {
        Write-RunnerLog "Run $runId failed with exit code $($process.ExitCode); stopping for review."
        [System.IO.File]::WriteAllText($stopPath, "Run failed at $([DateTime]::UtcNow.ToString('s'))Z; inspect $runLogPath`n")
        return $false
    }
    if (-not (Test-Path -LiteralPath $summaryPath)) {
        Write-RunnerLog "Run $runId did not produce a final summary; stopping for review."
        [System.IO.File]::WriteAllText($stopPath, "Missing summary at $([DateTime]::UtcNow.ToString('s'))Z`n")
        return $false
    }
    $summary = [System.IO.File]::ReadAllText($summaryPath)
    if ($summary -match '(?m)^CHRONICLE_RUNNER_STOP(?:\s|$)') {
        [System.IO.File]::WriteAllText($stopPath, "Queue complete or blocked at $([DateTime]::UtcNow.ToString('s'))Z`n")
        Write-RunnerLog "Run $runId marked the authorized queue complete or blocked; stopping."
        return $false
    }
    $readyMatch = [System.Text.RegularExpressions.Regex]::Match($summary, '(?m)^CHRONICLE_RUNNER_READY ([0-9a-f]{40})\s*$')
    if (-not $readyMatch.Success) {
        Write-RunnerLog "Run $runId did not report a verified commit; stopping for review."
        [System.IO.File]::WriteAllText($stopPath, "No verified commit marker at $([DateTime]::UtcNow.ToString('s'))Z; inspect $summaryPath`n")
        return $null
    }
    return [pscustomobject]@{ Continue = $true; Commit = $readyMatch.Groups[1].Value }
}

$mutexOwned = $false
try {
    $mutexOwned = $mutex.WaitOne(0)
    if (-not $mutexOwned) { Write-RunnerLog 'Another Chronicle runner instance owns the lock; exiting.'; exit 0 }
    if (Test-Path -LiteralPath $stopPath) { Write-RunnerLog "Stop marker exists at $stopPath; exiting."; exit 0 }

    do {
        $cycleStart = [DateTime]::UtcNow
        try {
            $state = Get-RepositoryState
            if ($state.Branch -ne 'main') {
                Write-RunnerLog "Expected branch main; found '$($state.Branch)'. Stopping without model invocation."
                [System.IO.File]::WriteAllText($stopPath, "Unexpected branch $($state.Branch)`n")
                break
            }
            if ($state.Origin -ne $ExpectedOrigin) {
                Write-RunnerLog 'Origin does not match the authorized repository; stopping without model invocation.'
                [System.IO.File]::WriteAllText($stopPath, "Unexpected origin $($state.Origin)`n")
                break
            }
            $pushOrigin = (& git -C $repoRoot remote get-url --push origin 2>&1 | Out-String).Trim()
            if ($LASTEXITCODE -ne 0 -or $pushOrigin -ne $ExpectedOrigin) {
                Write-RunnerLog 'Push origin differs from the authorized repository; stopping without model invocation.'
                [System.IO.File]::WriteAllText($stopPath, "Unexpected push origin $pushOrigin`n")
                break
            }
            if ($state.Head -ne $state.OriginMain) {
                Write-RunnerLog 'Local main is not aligned with cached origin/main; publish or synchronize it before another model run.'
                [System.IO.File]::WriteAllText($stopPath, "main and cached origin/main differ; review and synchronize before resuming.`n")
                break
            }
            if ($state.Status.Count -gt 0 -and -not [string]::IsNullOrWhiteSpace([string]$state.Status[0])) {
                Write-RunnerLog 'Working tree or index is not clean; stopping and preserving user changes.'
                [System.IO.File]::WriteAllText($stopPath, "Dirty repository at $([DateTime]::UtcNow.ToString('s'))Z; review it, then remove this marker to resume.`n")
                break
            }

            Write-RunnerLog "Starting a bounded Codex cycle on main."
            $cycleResult = Invoke-CodexCycle
            $continueRunning = $null -ne $cycleResult -and $cycleResult.Continue
            if ($continueRunning) {
                $after = Get-RepositoryState
                if ($after.Branch -ne 'main' -or $after.Origin -ne $state.Origin -or $after.Status.Count -gt 0) {
                    Write-RunnerLog 'Run left the repository dirty or changed its branch/remote; stopping to preserve the result.'
                    [System.IO.File]::WriteAllText($stopPath, "Review the run result and repository state before resuming.`n")
                    $continueRunning = $false
                } elseif ($after.Head -ne $cycleResult.Commit -or $after.Head -eq $state.Head -or $after.Parent -ne $state.Head) {
                    Write-RunnerLog 'Run did not create exactly one new commit on the starting main commit; stopping for review.'
                    [System.IO.File]::WriteAllText($stopPath, "Expected one verified commit with parent $($state.Head). Review before resuming.`n")
                    $continueRunning = $false
                } elseif ($after.OriginMain -ne $state.Head) {
                    Write-RunnerLog 'Cached origin/main changed during the run; preserving the local commit without pushing.'
                    [System.IO.File]::WriteAllText($stopPath, "origin/main changed during the cycle; inspect commit $($after.Head) before resuming.`n")
                    $continueRunning = $false
                } else {
                    $checkOutput = @(& git -C $repoRoot show --check --oneline $after.Head 2>&1)
                    if ($LASTEXITCODE -ne 0) {
                        Write-RunnerLog 'Git commit whitespace validation failed; preserving the local commit.'
                        [System.IO.File]::WriteAllText($stopPath, "Commit $($after.Head) failed git show --check; review before resuming.`n")
                        $continueRunning = $false
                    } else {
                        Write-RunnerLog "Pushing verified commit $($after.Head) normally to the exact authorized origin."
                        $previousErrorAction = $ErrorActionPreference
                        $ErrorActionPreference = 'Continue'
                        try {
                            $pushOutput = @(& git -C $repoRoot push origin main 2>&1)
                            $pushExitCode = $LASTEXITCODE
                        }
                        finally {
                            $ErrorActionPreference = $previousErrorAction
                        }
                        if ($pushExitCode -ne 0) {
                            Write-RunnerLog "Normal push failed; preserving local commit $($after.Head): $($pushOutput -join ' ')"
                            [System.IO.File]::WriteAllText($stopPath, "Push failed; verified local commit $($after.Head) remains for review.`n")
                            $continueRunning = $false
                        } else {
                            $published = (& git -C $repoRoot rev-parse refs/remotes/origin/main 2>&1 | Out-String).Trim()
                            if ($LASTEXITCODE -ne 0 -or $published -ne $after.Head) {
                                Write-RunnerLog "Push exited successfully but cached origin/main could not confirm $($after.Head); stopping for review."
                                [System.IO.File]::WriteAllText($stopPath, "Inspect remote publication for $($after.Head) before resuming.`n")
                                $continueRunning = $false
                            } else {
                                Write-RunnerLog "Verified origin/main at $published."
                            }
                        }
                    }
                }
            }
        }
        catch {
            Write-RunnerLog "Runner error: $($_.Exception.Message)"
            [System.IO.File]::WriteAllText($stopPath, "Runner error at $([DateTime]::UtcNow.ToString('s'))Z: $($_.Exception.Message)`n")
            $continueRunning = $false
        }

        if ($Once -or -not $continueRunning -or (Test-Path -LiteralPath $stopPath)) { break }
        $remaining = [TimeSpan]::FromMinutes($IntervalMinutes) - ([DateTime]::UtcNow - $cycleStart)
        if ($remaining.TotalSeconds -gt 0) { Start-Sleep -Seconds ([int][Math]::Ceiling($remaining.TotalSeconds)) }
    } while ($true)
}
finally {
    if ($mutexOwned) { $mutex.ReleaseMutex() }
    $mutex.Dispose()
}
