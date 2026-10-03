# Changelog

Record meaningful changes. Implementation, verification, and deployment are separate claims.

## Unreleased

- Preserve bound fixture provenance in branch comparisons after append-only reported checks without accepting unrelated manifest edits.
- Show uniquely bound fixture injection counts in saved branch comparisons, keeping unbound or ambiguous evidence and live-tool activity unavailable.
- Tell the autonomous worker to finish running command sessions before beginning another final check pair; retain the strict gate that rejected overlapping checks.
- Refuse fixture subprocess evidence binding when its saved cassette is missing, redirected, oversized, or differs from the hash pinned before launch.
- Keep oversized or non-regular fixture launch witnesses pending for inspection instead of reading redirected or unbounded evidence during recovery.
- Capture native Codex stderr separately from strict JSONL evidence so harmless diagnostics do not block a passing autonomous cycle.
- Refuse fixture-run recovery when an existing child launch witness is unreadable or disagrees with the recorded child PID; retain the pending evidence for inspection.
- Recognize Codex's exact quoted `cmd.exe /c` form for final sandboxed checks while refusing compound commands; preserve and independently publish the valid cycle rejected by the earlier gate.
- Record a child-owned fixture launch witness so recovery can resolve a dead controller's `spawning` run after an observed child PID has exited; leave missing or malformed witnesses pending.
- Refuse autonomous publication when recorded tool activity follows the final sandboxed syntax and test checks.
- Preserve detectable interrupted fixture-run journal replacements for inspection and refuse evidence binding while a replacement candidate exists.
- Record a pre-spawn fixture subprocess phase so recovery can fail a dead controller's run before spawn, while retaining uncertain launches for inspection.
- Allow the optional Windows review task to start and continue on battery after the user's explicit choice; leave system power-plan behavior unchanged.
- Exercise pending fixture-run recovery by terminating a real controller process after PID publication; retain the remaining crash-window limits.
- Record fixture subprocess controller/child PIDs and conservatively fail pending runs only after both processes are absent; retain partial evidence and pinned cassettes.
- Own a controlled fixture MCP subprocess, record its bounded evidence and exit, and gate candidate branch binding on successful replay; crash-window recovery remains open.
- Add a fixture-level controller API with bounded sequenced MCP evidence, in-process completion, and checked binding to one fresh branch output; process and host provenance remain unimplemented.
- Define the O014 controller-owned fixture-run/branch correlation contract, including stale-binding refusal and explicit unavailable live-tool provenance; the initial in-process slice is described above.
- Emit bounded rejection evidence for the first stopped fixture MCP tool attempt, distinct from successful cassette injection.
- Validate one ordered, read-only fixture MCP tool-call sequence in Codex CLI 0.160.0 using temporary host configuration; full fresh-agent replay remains unverified.
- Record observed Codex CLI fixture MCP tool discovery and the remaining tool-call/privacy boundary; the overnight supervisor completed four guarded automatic publications before stopping on its queue-blocked marker.
- End fixture MCP stdio replay with a failure when its input stream closes before EOF, avoiding a hung session after an abrupt host disconnect.
- Stop fixture MCP replay after rejecting an unsupported JSON-RPC batch, so a later call cannot consume a response intended for a batched tool call.
- Stop fixture MCP replay when a tool call arrives before initialization completes; a later call cannot consume its uncertain cassette response.
- Stop fixture MCP stdio replay on a malformed JSON or UTF-8 frame so a later valid call cannot consume an uncertain cassette response.
- Treat Git's nonfatal line-ending diagnostics as data in the Windows supervisor, and decide validation, staging, and commit success by Git exit codes.
- Stop experimental MCP cassette replay when a tool call has a missing or invalid JSON-RPC request ID; later calls cannot consume its response.
- Let the sandboxed Codex worker leave tracked-file edits and test evidence for the trusted runner to validate, commit, and publish without executing model-edited code outside the sandbox; preserve unsupported or failing results behind `STOP`.
- Recheck the authorized Git push URL after each Codex cycle; stop and preserve its verified local commit if the destination changed during the run.
- Keep native Codex diagnostics from aborting the Windows runner; record run output as UTF-8 and check the CLI exit code.
- Stop fixture MCP replay after a malformed tool call, so later calls cannot consume cassette responses.
- Use the supported Codex CLI config override for unattended approval policy; the removed `--ask-for-approval` flag stopped the first real runner cycle before any model work.
- Fix the Windows overnight-task installer by using Task Scheduler's default battery-start restriction instead of an unsupported PowerShell switch.
- Add a safe heartbeat/laptop-runner switch-over runbook with actual cycle caps and sleep, login, AC-power, usage, and stop-marker limits.
- Clarify that fixture-level simulated response injection exists while fresh-agent orchestration and full environment restoration remain future work.
- Close a storage-path symlink bypass: resolve the repository-specific store before creating history folders, and reject canonical paths inside the recorded workspace.
- Reject symlinked or non-directory snapshot-store children before creating internal history directories, preventing blob or metadata writes from being redirected through a pre-existing child link.
- Documented that the fixture MCP server implements the legacy 2025-11-25 handshake only; a test now records its deterministic response to a modern `server/discover` probe.
- MCP stdio replay now pauses request processing on stdout backpressure, waits for buffered responses before finalizing EOF, and exits cleanly with a failure when the host closes its output pipe.
- Corrected MCP replay shutdown documentation and added child-process coverage for post-mismatch calls and EOF failure.
- Documented removable Codex CLI and Claude Code MCP registration plus no-prompt tool discovery; clarified the expected incomplete-cassette shutdown and model-credit boundary.
- Standardized Claude/Codex fixture events on a privacy-bounded versioned contract with outcome certainty and checkpoint/gap references; unsupported adapter events fail closed, and recovery leaves prior records byte-identical.
- Added a bounded allowlisted simulated-tool response cassette and scripted task demo in two disposable worktrees from one baseline. It refuses unmatched calls without a live fallback; real AI-agent/workspace orchestration remains pending.
- Added a deterministic headless sample-app reset fixture with a SHA-256 environment fingerprint; tests verify drift is reset and both replay branches start with the same fixture state.
- Added a dependency-free experimental MCP stdio subset for the allowlisted replay cassette, with JSON-RPC child-process tests and fail-closed mismatch/incomplete behavior. Host registration remains unverified.

### 2026-10-02 — Add a guarded Windows laptop runner

- Added an optional login-time Task Scheduler setup for bounded local Codex CLI review cycles, with serialized runs, clean-main/authorized-origin guards, 25-minute timeout, network disabled, AC-power requirement, and stop-on-error behavior.
- The network-disabled Codex process commits verified work; the wrapper validates and normally pushes exactly one commit to the approved origin. It must not overlap with the chat heartbeat on the same checkout. Codex CLI 0.160.0 was installed and its ChatGPT login verified, but the scheduled task remains unregistered pending scheduler choice. Fake-CLI tests and limitations are recorded in [ORCHESTRATION.md](ORCHESTRATION.md) and [REVIEW.md](REVIEW.md).

### 2026-10-02 — Record user-run check evidence

- Added `record-check` for developers to attach a short label and exit code after they run a check themselves. Chronicle stores the timestamp and marks the outcome as user-reported; it does not execute or independently verify the command.
- The saved-branch comparison now shows each recorded check with its source and outcome. Labels stay bounded and rendered as escaped text; no command arguments are needed.
- Tests and final verification are tracked in O012 and [REVIEW.md](REVIEW.md).

### 2026-10-02 — Compare saved branches in VS Code

- Added **Chronicle: Compare Saved Branches**, a read-only view for selecting two completed operations and comparing their recorded files, output modes, runtime, coverage, and unavailable check/cost values. Stored paths and branch names are HTML-escaped; the panel runs no scripts, checks, or agents.
- Added mocked extension coverage for command selection, comparison rendering, and hostile text escaping. Real VS Code host validation remains O004.

### 2026-10-02 — Save and compare branch evidence

- Completed branch operations now save schema-versioned manifests with checkpoint IDs, baseline commit, selected change IDs, observed host labels, capture coverage, measured runtime facts, and output file hashes/modes.
- Added read-only `compare-operations` output for added, deleted, changed, and identical paths across two completed branches. Check results and reported cost stay clearly unavailable until measured; no test or agent run is started by comparison.
- Focused and full verification plus final diff review are recorded in [REVIEW.md](REVIEW.md). Explicit user-run check-result capture remains queued.

### 2026-10-02 — Add research-backed upgrade and learning notes

- Read five primary papers on failure reproduction, coding-agent interfaces and task complexity, controlled browser-agent environments, and benchmark validity.
- Added a staged roadmap, research learnings, and explicit replay-level boundaries in the architecture. Recommendations are labeled as inferences; no proposed upgrade is described as implemented. See [upgrades.md](upgrades.md), [learnings.md](learnings.md), and [architecture.md](architecture.md).

### 2026-10-02 — Audit first-release coverage and normalize Git diffs

- Force plain diff output and standard blank-context rows so user Git display settings cannot hide changes or corrupt within-hunk selection offsets. Added an isolated Git-home regression covering both partial previews and branch output.
- Corrected the branch name in VS Code's undo confirmation and verified its text in the mocked editor workflow.
- Added [first-release audit](RELEASE_AUDIT.md), reconciled installed-host claims, and retained real host/UI validation as the release blocker. Codex CLI 0.159.2 is available; lifecycle hook execution remains unverified. Checks and final review are in [REVIEW.md](REVIEW.md).

### 2026-10-02 — Select change groups inside hunks

- Added stable checkpoint-pair IDs for contiguous changed-line groups within a hunk. Replacement lines remain linked; the VS Code review UI offers group checkboxes alongside whole-hunk selection. The preview rebuilds from saved baseline/result slices, preserving unchanged lines and line endings.
- Verified partial selection in a single hunk, a two-line replacement, output branch bytes, UTF-8 BOM/CRLF preservation, stale group rejection, and UI rendering. Full suite and final checks recorded in [REVIEW.md](REVIEW.md).

### 2026-10-02 — Add guarded undo for output operations

- Added CLI and VS Code undo actions scoped to selected paths in Chronicle's output worktree. The operation refuses later edits, staged selected files, changed branches, or new commits; it retains the branch/worktree and can resume an interrupted undo after validating every affected path.
- Tests cover edited, staged, committed, unrelated, added/deleted, and interrupted output; `npm test` passes (25 tests), syntax check and 40-of-80 demo pass. Real VS Code UI remains unverified.

### 2026-10-02 — Add Codex CLI hook adapter

- Added a portable plugin manifest and separate Codex hook config for supported session, interrupt, and local tool boundaries.
- Reused the privacy-safe recorder; Codex tool completion is recorded as observed because its current hook schema has no distinct post-tool-failure event and `PostToolUse` also follows non-zero Bash exits.
- All 22 tests pass, including Codex privacy/config fixtures. A real Codex CLI session is unavailable on this machine; see [REVIEW.md](REVIEW.md).

### 2026-10-02 — Reconcile interrupted branch output

- Added read-only `reconcile` to compare operation journals with registered Git worktrees and branch refs, identify interrupted output and later edits by expected hashes, and point to retained paths without changing them. Expected uncommitted branch changes are not reported as post-completion edits.
- Verified prepared/applying/failed/completed states, an existing-branch conflict, and preservation of developer edits in an interrupted output worktree. All 20 tests, syntax checks, the demo, relative Markdown links, and whitespace checks pass. Automatic operation resumption and undo remain open.

### 2026-10-02 — Capture gaps and atomic blobs

- Persisted bounded, sanitized failed-capture events; added CLI inspection and checkpoint-interval review display.
- Changed snapshot blob creation to fsynced temporary files plus atomic content-hash publication; added interruption/retry coverage.
- Added explicit storage recovery that quarantines incomplete temp files, reports unfinished journals, and only archives locks after confirming their owner process is dead and the user confirms.
- Resolve storage directory symlinks before enforcing the outside-repository boundary; added a regression test against redirecting the store into the source tree.
- Review and verification passed during that capture/storage cycle: 18 tests, syntax checks, and the 40-of-80 demonstration. Branch-operation reconciliation is now available; automatic resumption remains open.

### 2026-10-02 — Autonomous development workflow

- Added a concrete autonomous task queue with verification criteria, handoff updates, and scope boundaries.
- Defined a review → fix → tests → final review cycle, with findings and evidence stored in REVIEW.md.
- Configured ACTIVE heartbeat `chronicle-review-and-improve`, every 30 minutes, with user-authorized commits and normal pushes after verification. The first scheduled review activation ran on 2026-10-02. Runtime availability and model usage remain constraints; no always-on server was deployed.
- Expanded each activation prompt to target up to about 25 minutes of focused work across multiple viable tasks; Codex controls the actual duration.

### 2026-10-02 — First local implementation

- Added dependency-free checkpoint capture, content integrity checks, diff hunks, preview, and independent branch/worktree output.
- Added a CLI, VS Code review panel, and development launch configuration.
- Added Claude plugin configuration and a bounded hook-payload recorder, including failed-tool boundaries.
- Added a runnable 40-of-80 demonstration and integration tests for dirty baselines, index preservation, line endings, exclusions, invalid selections, failure journals, hook privacy, and editor preview gating.
- Added run instructions and recorded the temporary JavaScript/JSON/plain-webview stack decision.

Real Claude/VS Code host sessions, automatic recovery, undo, and a Codex adapter remain unverified or unimplemented. No deployment or publication is included.

### 2026-10-02 — Architecture and living documentation

- Defined the proposed local engine, adapters, editor panel, checkpoints, selection, branch operations, and recovery.
- Narrowed first-release scope to selective file changes without automatic model requests.
- Added working instructions, milestone criteria, decisions, and handoff.
- Updated the README to reflect the current direction and link the docs.
- Added contribution guidance and issue/PR templates with acceptance criteria, verification, and documentation-update prompts.

This earlier documentation change included no runtime implementation or deployment.
