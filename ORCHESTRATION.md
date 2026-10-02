# Autonomous development orchestration

## Purpose

Continuously review and improve the local Chronicle prototype without requiring a new prompt for every task. The user authorized autonomous development orchestration on 2026-10-02 and specified the cycle: review, update, review again.

The existing chat heartbeat runs review work when this chat runtime is available. An optional Windows Codex CLI runner is provided for a logged-in laptop session. These are alternatives for the same checkout: never run both at once because they do not share a process lock. Scheduler configuration is authoritative; this file describes the development workflow.

Configured heartbeat: `chronicle-review-and-improve`, ACTIVE as of 2026-10-02. It is scheduled every 30 minutes. Each activation targets up to about 25 minutes of focused work, continuing across independent review, implementation, verification, documentation, commit, and push steps instead of stopping after one small change. The exact runtime is controlled by Codex and is not guaranteed to fill the entire window. The first scheduled review activation ran on 2026-10-02.

The chat heartbeat still depends on its desktop runtime. The local runner depends on Windows being awake, this user being logged in, internet/model access, valid Codex CLI authentication, and available account usage. Model-driven runs consume usage; the finished local recorder and Git helper have a separate no-model path.

## Optional Windows laptop runner

`scripts/run-autonomous.ps1` starts one `codex exec` cycle every 30 minutes, allowing up to 25 minutes per cycle. `scripts/install-autonomous-task.ps1` registers it at this user's Windows logon; it runs with limited user privileges, waits until AC power is available, and does not wake the laptop. Windows Task Scheduler's zero execution limit allows the supervisor process to continue indefinitely; each Codex child still has a 25-minute timeout ([Microsoft task scheduler setting](https://learn.microsoft.com/en-us/windows/win32/taskschd/taskschedulerschema-executiontimelimit-settingstype-element)). Before installing, verify `codex --version` and `codex login status`. The installer refuses to register when the CLI is absent or unauthenticated. Run `scripts/uninstall-autonomous-task.ps1` to request a graceful stop and, after the active run ends, remove the task.

The runner requires a clean `main` checkout and matching fetch and push URLs for the exact authorized `origin` before each model call. It uses `codex exec --sandbox workspace-write --ask-for-approval never` with `sandbox_workspace_write.network_access=false`, a single-process mutex, a per-run timeout, and logs under `%LOCALAPPDATA%\Chronicle\runner`. It stops on an error, timeout, dirty result, unexpected branch/remote, missing verified-commit marker, or the explicit queue-complete marker. After Codex commits exactly one clean verified child of the starting commit, the wrapper runs `git show --check`, pushes `main` normally to that exact origin, then verifies the cached `origin/main` ref equals the commit. The Codex process itself has no network access. A push failure preserves the local commit and writes `STOP`; inspect logs and review/synchronize before removing `STOP` to resume.

Run JSONL and final-summary files can contain source excerpts or tool output. They remain under the user's local profile and are not automatically deleted; inspect their contents and storage use, and do not commit or share them.

Do not install or start this local task while the chat heartbeat is active on the same checkout. Pause the heartbeat first to prevent overlapping writers. This checkout is shared with the user; leave it idle while an unattended cycle is running. Codex CLI 0.160.0 and ChatGPT login were verified in the approved installation context; the ordinary workspace shell still cannot read the global npm shim directly. The local task has not been registered, and real Task Scheduler lifecycle behavior is unverified. Runner tests use a fake CLI and disposable local bare Git remote; they verify wrapper push logic without contacting GitHub, invoking a model, or registering a scheduled task.

## Work loop

1. Read AGENTS.md, HANDOFF.md, PLAN.md, ORCHESTRATION.md, REVIEW.md, upgrades.md, and learnings.md. Incorporate newer human instructions.
2. Inspect Git status and current work before making changes. Preserve existing uncommitted prototype and documentation work.
3. Review current code and recent changes for concrete bugs, regressions, missing checks, and stale claims. Record actionable findings with file/function evidence in REVIEW.md. Prioritize preservation of user work and correctness over cosmetic edits.
4. Choose the highest-impact actionable finding, or one pending queue task if the focused review finds no issue. Mark it in progress, implement a focused change, and run meaningful verification. If blocked, record specific evidence and choose another viable independent task.
5. Review the final diff in a second pass, including edge cases and regression risks. Update REVIEW.md with findings, fix evidence, checks, unresolved concerns, and next step. Mark the task verified only if acceptance criteria pass; otherwise preserve an accurate pending or blocked state.
6. Update HANDOFF.md and relevant plan, architecture, decisions, changelog, and run instructions.
7. Continue with the next viable queue task until roughly 25 minutes of this activation have elapsed, unless all scope is complete or a concrete stopping condition applies. Before ending, update HANDOFF.md with the next task. If meaningful verified changes exist, inspect the final diff, stage only task-related files, and commit with a clear message. The chat heartbeat may push normally. For the laptop runner, its wrapper (not the network-disabled Codex child) pushes one commit only after validating the exact origin, starting parent, clean result, commit marker, whitespace check, and published tracking ref. Do not create empty or unchanged-status-only commits. Report commit and push outcome accurately.

Do not launch nested model loops or duplicate worker chats. The optional local supervisor is the only laptop runner for this checkout; do not register another scheduled task for it, and never run it alongside the chat heartbeat. Do not run parallel writers in this checkout. If another run is modifying the same task, defer rather than interleave writes. Queue status is cooperative coordination, not an enforced process lock.

Reviewer, implementer, and verifier are sequential stages in this thread. Do not claim an independent second agent approved a change unless that review actually occurred.

## Queue

| ID | State | Task | Acceptance criteria |
| --- | --- | --- | --- |
| O001 | Verified | Persist and expose capture gaps | Skipped/busy/failed recording boundaries remain inspectable without storing raw secret-bearing payloads; CLI and review UI show coverage honestly; integration tests pass |
| O002 | Verified | Recover interrupted recording storage | Interrupted JSON/blob temps move into quarantine; unfinished journals are listed; only a confirmed dead-owner lock is archived; live/unreadable locks remain; interruption tests pass |
| O003 | Verified | Reconcile branch operations | Reconcile prepared/applying/failed journal states with actual branches and worktrees; preserve modified output workspaces; verify interruption and conflict cases |
| O004 | Blocked (host access) | Validate a real editor and Claude integration | Claude CLI is absent; VS Code CLI exists but native editor interaction is unavailable in this runtime. Codex CLI 0.159.2 is present; version/help checks do not validate plugin trust or hook delivery. Resume using the real-host procedure in RELEASE_AUDIT.md when prerequisites are available. |
| O005 | Verified | Guarded undo for Chronicle output | Restores only selected paths in Chronicle's output worktree after checking branch, staged state, bytes, and modes; refuses later edits or commits; retries interrupted undos conservatively; CLI and VS Code action have guidance; focused tests pass |
| O006 | Verified | Finer change-group selection | Exposes contiguous changed-line groups within hunks, links replacement lines, validates reconstructed preview/branch bytes, preserves UTF-8 BOM and CRLF fixtures; UI rendering and full tests pass |
| O007 | Verified (fixture-level) | Evaluate and add a Codex capture adapter | Official hook events were checked; supported boundaries are configured, passed through the shared privacy-safe recorder, and fixture-tested. Real Codex CLI validation remains part of O004's host prerequisite. |
| O008 | Verified (local audit) | First-release audit | Current tests/check/demo pass; RELEASE_AUDIT.md records actual host coverage and limitations; docs reconciled and local result presented. Release readiness still depends on O004. |
| O009 | Verified (documentation) | Research-backed roadmap and architecture | upgrades.md sequences proposed work; learnings.md synthesizes primary papers and separates evidence from inference; architecture.md distinguishes implemented behavior from future replay tiers; relative links and consistency checks pass. No proposed capability is presented as shipped. |
| O010 | Verified (CLI/file layer) | Persist branch evidence and compare outputs | Completed operations save schema-1 source/checkpoint/selection/environment/coverage/output manifests; read-only CLI comparison reports directional added/deleted/changed/identical paths. Regression covers two selections and preserves unavailable check/cost fields. Full tests, demo, docs, syntax, and whitespace pass. |
| O011 | Verified (mocked editor) | Present side-by-side branch comparison | VS Code command selects exactly two completed manifest-backed operations and renders escaped file hashes/modes, directional status, measured environment, coverage, and unavailable checks/cost without executing commands. Mocked editor, syntax, full-suite, demo, and docs checks pass. Real VS Code validation remains blocked under O004. |
| O012 | Verified (user-reported evidence) | Record explicit check results | `record-check` appends a bounded user-reported label, timestamp, and exit code to a completed manifest without executing commands; comparison UI renders report status/source. Mocked CLI/editor tests cover reported pass/fail, validation, and escaping. Full test, syntax, demo, docs, and whitespace checks pass. |
| O013 | Verified (fixture-level) | Standardize adapter event evidence | Claude/Codex hooks map through versioned schema-1 `chronicle.adapter-event` records with boundary/status certainty, recorder timestamp, privacy-safe metadata, and snapshot/gap references; unsupported source/boundary pairs fail closed and storage recovery preserves legacy checkpoint/gap bytes. Four focused integration tests pass. Real host delivery remains under O004. |
| O014 | In progress (scripted worktree fixture verified) | Controlled simulated-tool replay | Implemented a bounded ordered cassette response injector with two allowlisted sample tools, exact canonical input matching, deterministic injection hashes, and no live fallback. The demo creates two disposable Git worktrees from one commit and runs a deterministic scripted README task with alternate instructions; tests assert the source stays unchanged. It does not launch an AI agent, intercept vendor tools, or replay browser/OS state. |

Task priority may change to address a concrete bug or unmet prerequisite within PLAN.md. Record the reason. Do not expand to hosted collaboration, browser/database replay, billing, or production deployment without user direction.

## Boundaries and stopping

Autonomous implementation, focused tests, living-document updates, commits, and normal pushes are authorized. Current destination: `origin` at `https://github.com/7se7en72025/Chronicle.git`, branch `main`. Recheck the branch and remote before each push; do not silently redirect publication.

Do not commit failing work, unrelated changes, secrets, private snapshots, or generated artifacts. Preserve pre-existing staging. Never force-push or rewrite history. If the remote rejects a push, report the reason and retain the verified local commit; do not blindly overwrite remote work.

Marketplace publication, purchases, account changes, external messages, destructive cleanup, and deployment remain outside this workflow.

When every queued task is verified, report completion and require user direction for new scope. If no task can progress, record concrete blockers and avoid repetitive edits. Respect a human stop or pause request immediately.

The intended loop is a scheduled activation every 30 minutes with up to about 25 minutes of focused work per activation. It is not a continuously running process. Codex controls actual run duration and availability; the local desktop must be available. An always-on server would require separate deployment.
