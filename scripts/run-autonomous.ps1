param(
    [switch]$Once,
    [switch]$Worker,
    [string]$CodexCommand = 'codex',
    [string]$ExpectedOrigin = 'https://github.com/7se7en72025/Chronicle.git',
    [string]$CodexPath,
    [string]$PromptPath,
    [string]$RunLogPath,
    [string]$StderrLogPath,
    [string]$SummaryPath,
    [int]$IntervalMinutes = 30,
    [int]$MaxRunMinutes = 25,
    [long]$MinimumFreeBytes = 2GB
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
                & $CodexPath exec --sandbox workspace-write --config approval_policy=never --config sandbox_workspace_write.network_access=false --ephemeral --json --output-last-message $SummaryPath $env:CHRONICLE_AUTONOMOUS_PROMPT 2> $StderrLogPath | ForEach-Object { $logWriter.WriteLine([string]$_) }
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
        [System.IO.File]::AppendAllText($StderrLogPath, "`nWorker error: $($_.Exception.Message)`n")
        exit 1
    }
}

if ($IntervalMinutes -lt 1 -or $MaxRunMinutes -lt 1 -or $MaxRunMinutes -ge $IntervalMinutes -or $MinimumFreeBytes -lt 1) {
    throw 'Use positive intervals and storage threshold, with MaxRunMinutes shorter than IntervalMinutes.'
}

$stateRoot = if ($env:CHRONICLE_RUNNER_STATE) {
    $env:CHRONICLE_RUNNER_STATE
} else {
    Join-Path $env:LOCALAPPDATA 'Chronicle\runner'
}
[System.IO.Directory]::CreateDirectory($stateRoot) | Out-Null
$noHooksPath = Join-Path $stateRoot 'no-hooks'
[System.IO.Directory]::CreateDirectory($noHooksPath) | Out-Null
$stopPath = Join-Path $stateRoot 'STOP'
$runnerLogPath = Join-Path $stateRoot 'runner.log'
$mutexHash = [System.BitConverter]::ToString([System.Security.Cryptography.SHA256]::Create().ComputeHash([System.Text.Encoding]::UTF8.GetBytes($repoRoot))).Replace('-', '').Substring(0, 24)
$mutex = New-Object System.Threading.Mutex($false, "Local\ChronicleRunner-$mutexHash")

function Write-RunnerLog([string]$Message) {
    $line = '{0} {1}{2}' -f [DateTime]::UtcNow.ToString('s'), $Message, [Environment]::NewLine
    [System.IO.File]::AppendAllText($runnerLogPath, $line, (New-Object System.Text.UTF8Encoding($false)))
}

function Get-LowSpaceVolumes([string[]]$Paths, [long]$MinimumBytes) {
    $checkedRoots = @{}
    $lowSpace = @()
    foreach ($path in $Paths) {
        if ([string]::IsNullOrWhiteSpace($path)) { continue }
        $root = [System.IO.Path]::GetPathRoot([System.IO.Path]::GetFullPath($path))
        if ([string]::IsNullOrWhiteSpace($root) -or $checkedRoots.ContainsKey($root)) { continue }
        $checkedRoots[$root] = $true
        $drive = New-Object System.IO.DriveInfo($root)
        if (-not $drive.IsReady) { throw "Cannot verify available storage on $root." }
        if ($drive.AvailableFreeSpace -lt $MinimumBytes) {
            $lowSpace += [pscustomobject]@{ Root = $root; FreeBytes = $drive.AvailableFreeSpace }
        }
    }
    return $lowSpace
}

function Invoke-GitCommand([string[]]$GitArguments) {
    $previousErrorAction = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    try {
        $output = @(& git @GitArguments 2>&1)
        $exitCode = $LASTEXITCODE
    }
    finally {
        $ErrorActionPreference = $previousErrorAction
    }
    return [pscustomobject]@{ Output = $output; ExitCode = $exitCode }
}

function Test-RunEvidence([string]$RunLogPath) {
    $syntaxPassed = $false
    $testPassed = $false
    foreach ($line in [System.IO.File]::ReadLines($RunLogPath)) {
        if ([string]::IsNullOrWhiteSpace($line)) { continue }
        try { $event = $line | ConvertFrom-Json -ErrorAction Stop } catch { return $false }
        if ($event.type -notin @('item.started', 'item.completed')) { continue }
        if ($event.item.type -eq 'agent_message') { continue }
        if ($event.item.type -ne 'command_execution') {
            $syntaxPassed = $false
            $testPassed = $false
            continue
        }
        $command = [string]$event.item.command
        $isSyntax = $command -match '(?i)(^npm(?:\.cmd)?\s+run\s+check\s*$|-Command\s+[''"]npm(?:\.cmd)?\s+run\s+check[''"]\s*$|^"[^"]*\\cmd\.exe"\s+/c\s+[''"]npm(?:\.cmd)?\s+run\s+check[''"]\s*$)'
        $isTest = $command -match '(?i)(^npm(?:\.cmd)?\s+test\s*$|-Command\s+[''"]npm(?:\.cmd)?\s+test[''"]\s*$|^"[^"]*\\cmd\.exe"\s+/c\s+[''"]npm(?:\.cmd)?\s+test[''"]\s*$)'
        if ($event.type -eq 'item.started') {
            if ($syntaxPassed -and -not $testPassed -and $isTest) { continue }
            $syntaxPassed = $false
            $testPassed = $false
            continue
        }
        $passed = $event.item.status -eq 'completed' -and $event.item.exit_code -eq 0
        if ($isSyntax) {
            $syntaxPassed = $passed
            $testPassed = $false
        } elseif ($isTest -and $syntaxPassed) {
            $testPassed = $passed
            $syntaxPassed = $false
        } else {
            $syntaxPassed = $false
            $testPassed = $false
        }
    }
    return $testPassed
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
    $stderrLogPath = Join-Path $stateRoot "$runId.stderr.log"
    $summaryPath = Join-Path $stateRoot "$runId.summary.txt"
    $prompt = @'
Run one focused Chronicle review-and-improve cycle in this repository. First read AGENTS.md, HANDOFF.md, PLAN.md, ORCHESTRATION.md, REVIEW.md, upgrades.md, and learnings.md; inspect Git status and preserve existing work. Follow the highest-impact viable accepted queue item and current human instructions. Record evidence-based review findings, implement at most one meaningful queue task, inspect the final diff in a second pass, and update the living documents accurately. Distinguish implemented, proposed, and verified claims. Do not access the network, stage, commit, push, force-push, deploy, publish, or perform destructive cleanup. The Codex process has network disabled and Git metadata is read-only. Change tracked files only; leave no new, deleted, or staged files and do not edit runner scripts, AGENTS.md, ORCHESTRATION.md, or .gitattributes. If and only if all authorized queue work is complete or concretely blocked, make no speculative edits and make the final response's first line exactly CHRONICLE_RUNNER_STOP. Otherwise, finish all edits, documentation, and diff review before the final checks. As your last two tool actions, run `npm run check` and then `npm test` inside this sandbox, separately and in that order. After those checks, make no further tool calls or edits; respond with a standalone line `CHRONICLE_RUNNER_READY <short commit subject>` only if both pass. The trusted wrapper requires those final sandboxed check events with no later tool activity, verifies repository state, then stages tracked edits, commits once, and publishes only after its safety checks pass. Include a concise handoff and verification evidence.
'@
    $prompt += "`nWait for each command session to exit before starting another. If a tool returns a running session ID, poll that same session to completion; never start a new final check pair while an earlier check is still active.`n"
    $prompt += "`nDo not treat commands hidden by this worker's restricted PATH as proof that the laptop lacks a host: the supervisor already launched Codex. Real editor/host UI validation may be unavailable here, but first assess independent local O014 tasks recorded in HANDOFF.md and upgrades.md, including pre-witness launch recovery and durable fixture evidence. Stop only when those authorized local tasks are complete or each is concretely blocked; describe the specific blocker.`n"
    [System.IO.File]::WriteAllText($promptPath, $prompt, (New-Object System.Text.UTF8Encoding($false)))

    $powerShellExe = Join-Path $PSHOME 'powershell.exe'
    $workerArgs = @(
        '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', (Join-Path $PSScriptRoot 'run-autonomous.ps1'),
        '-Worker', '-CodexPath', $codexExecutable, '-PromptPath', $promptPath, '-RunLogPath', $runLogPath, '-StderrLogPath', $stderrLogPath, '-SummaryPath', $summaryPath
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
    $readyMatch = [System.Text.RegularExpressions.Regex]::Match($summary, '(?m)^CHRONICLE_RUNNER_READY ([A-Za-z0-9][A-Za-z0-9 .:_-]{0,71})\r?$')
    if (-not $readyMatch.Success) {
        Write-RunnerLog "Run $runId did not report a ready tracked-file result; stopping for review."
        [System.IO.File]::WriteAllText($stopPath, "No ready result marker at $([DateTime]::UtcNow.ToString('s'))Z; inspect $summaryPath`n")
        return $null
    }
    return [pscustomobject]@{ Continue = $true; Subject = $readyMatch.Groups[1].Value.Trim(); LogPath = $runLogPath }
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

            $codexHome = if ($env:CODEX_HOME) { $env:CODEX_HOME } else { Join-Path $env:USERPROFILE '.codex' }
            $lowSpaceVolumes = @(Get-LowSpaceVolumes -Paths @($repoRoot, $stateRoot, $codexHome, $env:TEMP, $env:TMP) -MinimumBytes $MinimumFreeBytes)
            if ($lowSpaceVolumes.Count -gt 0) {
                foreach ($volume in $lowSpaceVolumes) {
                    $freeMiB = [Math]::Floor($volume.FreeBytes / 1MB)
                    $minimumMiB = [Math]::Ceiling($MinimumFreeBytes / 1MB)
                    Write-RunnerLog "Available disk space on $($volume.Root) is ${freeMiB} MiB; require at least ${minimumMiB} MiB before a Codex cycle."
                }
                [System.IO.File]::WriteAllText($stopPath, "Insufficient disk space; free at least $([Math]::Ceiling($MinimumFreeBytes / 1MB)) MiB on each workspace, state, Codex, and temp volume, then review and remove STOP to resume.`n")
                break
            }

            Write-RunnerLog "Starting a bounded Codex cycle on main."
            $cycleResult = Invoke-CodexCycle
            $continueRunning = $null -ne $cycleResult -and $cycleResult.Continue
            if ($continueRunning) {
                $after = Get-RepositoryState
                if ($after.Branch -ne 'main' -or $after.Origin -ne $state.Origin -or $after.Head -ne $state.Head -or $after.OriginMain -ne $state.Head) {
                    Write-RunnerLog 'Run changed the branch, commit, fetch remote, or cached origin/main; stopping to preserve the result.'
                    [System.IO.File]::WriteAllText($stopPath, "Review the run result and repository state before resuming.`n")
                    $continueRunning = $false
                } elseif ($after.Status.Count -eq 0 -or [string]::IsNullOrWhiteSpace([string]$after.Status[0])) {
                    Write-RunnerLog 'Run reported a ready result without tracked file edits; stopping for review.'
                    [System.IO.File]::WriteAllText($stopPath, "No tracked edits to publish; review the run summary before resuming.`n")
                    $continueRunning = $false
                } elseif (@($after.Status | Where-Object { $_ -notmatch '^ M ' }).Count -gt 0) {
                    Write-RunnerLog 'Run left staged, untracked, deleted, or otherwise unsupported changes; stopping to preserve them.'
                    [System.IO.File]::WriteAllText($stopPath, "Unsupported worktree state; review the run result before resuming.`n")
                    $continueRunning = $false
                } elseif (@($after.Status | Where-Object { $_ -match '^ M (scripts/(run-autonomous|install-autonomous-task|uninstall-autonomous-task)\.ps1|\.gitattributes|AGENTS\.md|ORCHESTRATION\.md)$' }).Count -gt 0) {
                    Write-RunnerLog 'Run modified runner controls, agent instructions, or Git attributes; stopping for manual review.'
                    [System.IO.File]::WriteAllText($stopPath, "Trusted runner files changed; review before resuming.`n")
                    $continueRunning = $false
                } else {
                    $pushOrigin = (& git -C $repoRoot remote get-url --push origin 2>&1 | Out-String).Trim()
                    if ($LASTEXITCODE -ne 0 -or $pushOrigin -ne $ExpectedOrigin) {
                        Write-RunnerLog 'Push origin changed during the run; preserving the edits without committing or pushing.'
                        [System.IO.File]::WriteAllText($stopPath, "Push origin changed during the cycle; review edits before resuming.`n")
                        $continueRunning = $false
                    }
                    if ($continueRunning) {
                        $diffCheck = Invoke-GitCommand -GitArguments @('-C', $repoRoot, 'diff', '--check')
                        if ($diffCheck.ExitCode -ne 0) {
                            Write-RunnerLog 'Git diff whitespace validation failed; preserving the edits.'
                            [System.IO.File]::WriteAllText($stopPath, "Uncommitted diff failed git diff --check; review before resuming.`n")
                            $continueRunning = $false
                        }
                    }
                    if ($continueRunning) {
                        if (-not (Test-RunEvidence $cycleResult.LogPath)) {
                            Write-RunnerLog "Sandboxed npm test/check evidence is missing or failed; preserving edits. Inspect $($cycleResult.LogPath)"
                            [System.IO.File]::WriteAllText($stopPath, "Project check evidence missing or failed; inspect $($cycleResult.LogPath) before resuming.`n")
                            $continueRunning = $false
                        }
                    }
                    if ($continueRunning) {
                        $checked = Get-RepositoryState
                        if ($checked.Branch -ne 'main' -or $checked.Origin -ne $state.Origin -or $checked.Head -ne $state.Head -or $checked.OriginMain -ne $state.Head -or (($checked.Status -join "`n") -ne ($after.Status -join "`n"))) {
                            Write-RunnerLog 'Repository changed during independent checks; stopping to preserve edits.'
                            [System.IO.File]::WriteAllText($stopPath, "Repository changed during checks; review before resuming.`n")
                            $continueRunning = $false
                        }
                    }
                    if ($continueRunning) {
                        $stage = Invoke-GitCommand -GitArguments @('-C', $repoRoot, 'add', '-u')
                        if ($stage.ExitCode -ne 0) { throw 'Could not stage verified tracked edits.' }
                        $stagedCheck = Invoke-GitCommand -GitArguments @('-C', $repoRoot, 'diff', '--cached', '--check')
                        if ($stagedCheck.ExitCode -ne 0) { throw 'Staged diff failed whitespace validation.' }
                        $commit = Invoke-GitCommand -GitArguments @('-c', "core.hooksPath=$noHooksPath", '-C', $repoRoot, 'commit', '-m', $cycleResult.Subject)
                        if ($commit.ExitCode -ne 0) { throw 'Could not commit verified tracked edits.' }
                        $after = Get-RepositoryState
                        if ($after.Branch -ne 'main' -or $after.Origin -ne $state.Origin -or $after.OriginMain -ne $state.Head -or $after.Parent -ne $state.Head -or $after.Status.Count -gt 0) {
                            throw 'Committed result did not leave one clean child of the starting commit.'
                        }
                    }
                    if ($continueRunning) {
                        $pushOrigin = (& git -C $repoRoot remote get-url --push origin 2>&1 | Out-String).Trim()
                        if ($LASTEXITCODE -ne 0 -or $pushOrigin -ne $ExpectedOrigin) {
                            Write-RunnerLog 'Push origin changed before publication; preserving the local commit.'
                            [System.IO.File]::WriteAllText($stopPath, "Push origin changed; inspect commit $($after.Head) before resuming.`n")
                            $continueRunning = $false
                        }
                    }
                    if ($continueRunning) {
                        $checkOutput = Invoke-GitCommand -GitArguments @('-C', $repoRoot, 'show', '--check', '--oneline', $after.Head)
                        if ($checkOutput.ExitCode -ne 0) {
                            Write-RunnerLog 'Committed result failed whitespace validation; preserving the local commit.'
                            [System.IO.File]::WriteAllText($stopPath, "Commit $($after.Head) failed git show --check; review before resuming.`n")
                            $continueRunning = $false
                        }
                    }
                    if ($continueRunning) {
                        Write-RunnerLog "Pushing verified commit $($after.Head) normally to the exact authorized origin."
                        $previousErrorAction = $ErrorActionPreference
                        $ErrorActionPreference = 'Continue'
                        try {
                            $pushOutput = @(& git -c "core.hooksPath=$noHooksPath" -C $repoRoot push origin main 2>&1)
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
