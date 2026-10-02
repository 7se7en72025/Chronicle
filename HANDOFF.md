# Current handoff

Updated: 2026-10-03.

## State

The user authorized implementation. A dependency-free local prototype now exists: checkpoint engine, CLI, VS Code review panel, and optional Claude Code hook adapter. It is not published or deployed. The Windows Codex CLI task is registered against a clean sibling checkout at `C:\Users\RAIYYAN\Desktop\Code\Chronicle-night-runner`. The corrected CLI invocation reached a real model cycle, which found and partly fixed a malformed MCP call bug. PowerShell then treated Codex stderr from a failed patch attempt as terminating, so the supervisor wrote `STOP`; the replay fix passes the full local suite, but the wrapper still needs a stderr-handling fix. The user reports that the chat heartbeat is paused.

The current direction is a local companion for Codex or Claude Code: record supported file changes, review checkpoints, and apply selected changes without a new model request. See [architecture.md](architecture.md).

## Latest work

- Fixed the runner's unsupported `--ask-for-approval` option after the registered task stopped before model execution. Codex CLI 0.160.0 accepts `--config approval_policy=never`; the complete option set exits zero with `--help`, and all five focused runner tests pass. The sibling checkout is still held by the failure `STOP` marker until the fix is synchronized; see [REVIEW.md](REVIEW.md).
- Fixed the unsupported battery-setting switch in the Windows installer, verified the corrected settings object and five runner tests, then registered the Task Scheduler entry against the clean sibling checkout. With the temporary `STOP` marker present, the task started and exited before any model invocation. The task is `Ready`, points to the sibling checkout, disallows battery starts, and has no overall execution limit; see [REVIEW.md](REVIEW.md). The unrelated untracked `BOLPREP.md` in this checkout remains untouched.
- Expanded the overnight-runner handoff in [ORCHESTRATION.md](ORCHESTRATION.md): pause the chat heartbeat before starting the laptop writer, verify its login/task/log state, and stop/remove the task before returning to chat mode.
- Corrected replay scope wording in [upgrades.md](upgrades.md) and [architecture.md](architecture.md): the bounded fixture response injector exists; fresh-agent orchestration and full environment restoration remain unimplemented.
- Closed an internal storage-directory symlink bypass in `Chronicle.constructor`: pre-existing `blobs`, `checkpoints`, `operations`, `worktrees`, `gaps`, or `recovery` entries must be real directories. A fixture redirects `blobs` to a disposable repository and confirms construction stops before creating redirected history folders; see [REVIEW.md](REVIEW.md).
- Closed a storage symlink bypass in `Chronicle.constructor`: the repo-specific store path is now resolved and checked before snapshot subdirectories are created. A fixture verifies a hash-named symlink into a disposable repository is refused without creating Chronicle directories there; see [REVIEW.md](REVIEW.md).
- Rechecked MCP compatibility against the current `2026-07-28` specification. Chronicle's experimental MCP server remains a `2025-11-25` legacy-handshake subset; its docs now say dual-era clients must fall back and modern-only clients are incompatible. No current Codex/Claude behavior or host compatibility is inferred. See [upgrades.md](upgrades.md) and [learnings.md](learnings.md).
- Hardened the experimental replay MCP stdio loop against a slow host reader and early pipe closure: incoming frames pause at stdout backpressure, EOF waits until buffered replies drain, and output `EPIPE` ends the session cleanly with a failure status. Focused stream tests cover all three cases; see [REVIEW.md](REVIEW.md).
- Added the research-backed [upgrade roadmap](upgrades.md) and [learnings](learnings.md); clarified current versus proposed capabilities in [architecture.md](architecture.md). Five primary papers inform the recommendations; replay and environment-restore claims are explicitly bounded.
- Completed O008's [first-release audit](RELEASE_AUDIT.md). Fixed Git color/blank-context settings breaking selection and the undo confirmation's missing branch name. Actual host/UI validation remains outstanding; Codex CLI 0.159.2 was checked through version/help in an earlier activation only.
- Added an optional Windows supervisor and login-time Task Scheduler installer in `scripts/run-autonomous.ps1` and `scripts/install-autonomous-task.ps1`. Codex runs with network disabled; the supervisor allows only one clean verified commit, checks it, pushes normally to the exact authorized origin, and confirms the updated tracking ref. Codex CLI 0.160.0 and ChatGPT login were verified in the approved installation context. Registration and a STOP-gated launch are now verified; a real Codex work cycle is not yet verified.

- Added within-hunk change groups for nearby edits, keeping contiguous replacements together. Preview and branch output rebuild from saved file line slices; BOM/CRLF, stale IDs, multi-line replacements, insertions, and deletions are covered. O006 is verified; details are in [REVIEW.md](REVIEW.md).
- Added guarded undo for selected paths in Chronicle's output worktree through CLI and VS Code. It validates branch, staged state, and file bytes/modes; retains output and can resume a partial undo after revalidation. O005 is verified; details and limits are in [REVIEW.md](REVIEW.md).
- Implemented immutable supported-file capture, byte integrity checks, checkpoint diffs, complete-hunk selection, preview, and separate branch/worktree output.
- Added VS Code commands with preview gating and escaped webview content, plus direct CLI commands.
- Added Claude hook configuration and bounded payload recording for session/tool success/failure boundaries. Attribution remains explicitly uncertain.
- Added the 40-of-80 demo and [GETTING_STARTED.md](GETTING_STARTED.md).
- Updated architecture, decisions, plan, and contribution instructions to reflect actual prototype coverage.
- Persisted sanitized capture gaps for failed Claude hook checkpoints; exposed them in the CLI and review intervals.
- Made blob publication atomic so interruption cannot leave partial data at its permanent content hash.
- Added a recovery command that quarantines interrupted metadata/blob temps, lists unfinished journals, and explicitly archives only locks whose owner process is dead.
- Added a Codex CLI plugin-hook adapter and scoped hook manifest. Codex `PostToolUse` is recorded as observed because the official hook event does not establish tool success/failure.
- Added schema-versioned evidence manifests to completed branches and a no-model CLI comparison for added/deleted/changed/identical output files. Checks and cost remain unavailable until measured; see O010 in [ORCHESTRATION.md](ORCHESTRATION.md).
- Added **Chronicle: Compare Saved Branches** in VS Code; it compares two selected completed manifests without executing checks or agents. O011 is verified at mocked-editor level; explicit user-run check-result recording was queued as O012 and is now verified.
- Added `record-check` for developer-reported check labels and exit codes; it does not run or verify project commands. O012 is verified at CLI/editor-fixture level.
- Added the shared `chronicle.adapter-event` v1 schema for fixture-supported Claude/Codex hook events, including status certainty and checkpoint/gap references. Unsupported events fail closed, and recovery preserves prior record bytes; O013 is verified at fixture level only.
- Advanced O014 with a deterministic headless sample issue-tracker reset fixture and a dependency-free MCP stdio subset for replaying its allowlisted tools. The server supports initialize/ping/list/call, keeps stdout protocol-only, writes hash evidence to stderr, and rejects later calls after unknown tools or mismatches; it exits unsuccessfully when the host closes an incomplete or stopped session. Child-process tests exercise the wire format; no host MCP config is bundled or validated, and no model session was started.

The supplied [reference repository](https://github.com/medhu123/amzn_code) listing inspired the documentation structure. Linked contents could not be fetched, so internal practices were not audited or copied.

## Verification

The latest code implementation passed all 50 tests serially, including 5 Windows PowerShell runner tests, 8 MCP stdio tests, and the internal snapshot-directory symlink regression. `npm.cmd run check` passed. The installer fix passed five focused runner tests; the Windows settings object and STOP-gated Task Scheduler registration were verified locally. All 16 root Markdown files have zero broken relative links and `git diff --check` passes. Codex hook behavior, editor interactions, and an actual runner model cycle remain host-unvalidated.

Local Markdown targets and whitespace checked. A real editor session and Claude/Codex session remain untested. Claude CLI is not installed; VS Code CLI 1.139.1 is installed, but the current computer-use runtime exposes no app windows or native launch/input API, so the editor UI cannot be exercised in this activation.

The chat heartbeat `chronicle-review-and-improve` is configured every 30 minutes and is paused per the user. The optional local Windows runner is registered in a sibling checkout; do not resume the heartbeat while it runs. Follow [ORCHESTRATION.md](ORCHESTRATION.md) and store findings in [REVIEW.md](REVIEW.md). O013 is verified at fixture level only; consult Git history for publication status.

Scheduled development consumes model usage and requires an available runtime. The runner is an interactive Windows Scheduled Task, not a server or recorder service. Claude recording hooks remain separately event-driven during an enabled host session.

**Next:** fix the runner's PowerShell stderr handling, publish it, fast-forward the sibling checkout, clear `STOP`, and retry a bounded Codex cycle. Keep the chat heartbeat paused. Real Codex/Claude hook and editor validation remains separate; use the no-prompt MCP discovery steps in [GETTING_STARTED.md](GETTING_STARTED.md) when a supported host is available.

## Open choices

Real Claude/VS Code and Codex host validation, configurable exclusions, retention, SQLite/TypeScript migration, and automatic operation resumption remain outstanding. Codex adapter is fixture-tested only. First slice uses JavaScript and JSON metadata as recorded in D007. Branch output rejects checkpoints with reported exclusions. O006's within-hunk groups are implemented and fixture-verified.

## Next concrete task

Fix stderr handling after the first real Codex cycle was interrupted, then retry from a clean synchronized sibling checkout. The cycle may stop if the queue is blocked or complete; verify its actual log and repository state. O004 still needs a real editor/agent host for event-delivery and UI checks. See [REVIEW.md](REVIEW.md) for evidence and limits.
