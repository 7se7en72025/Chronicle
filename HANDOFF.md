# Current handoff

Updated: 2026-10-03.

## State

The user authorized implementation. A dependency-free local prototype now exists: checkpoint engine, CLI, VS Code review panel, and optional Claude Code hook adapter. It is not published or deployed. Windows scripts now provide an optional Codex CLI task runner, but the Scheduled Task has not been registered or host-validated.

The current direction is a local companion for Codex or Claude Code: record supported file changes, review checkpoints, and apply selected changes without a new model request. See [architecture.md](architecture.md).

## Latest work

- Added the research-backed [upgrade roadmap](upgrades.md) and [learnings](learnings.md); clarified current versus proposed capabilities in [architecture.md](architecture.md). Five primary papers inform the recommendations; replay and environment-restore claims are explicitly bounded.
- Completed O008's [first-release audit](RELEASE_AUDIT.md). Fixed Git color/blank-context settings breaking selection and the undo confirmation's missing branch name. Actual host/UI validation remains outstanding; Codex CLI 0.159.2 was checked through version/help in an earlier activation only.
- Added an optional Windows supervisor and login-time Task Scheduler installer in `scripts/run-autonomous.ps1` and `scripts/install-autonomous-task.ps1`. Codex runs with network disabled; the supervisor allows only one clean verified commit, checks it, pushes normally to the exact authorized origin, and confirms the updated tracking ref. Codex CLI 0.160.0 and ChatGPT login were verified in the approved installation context. The task is still unregistered to avoid overlap with the active chat heartbeat.

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
- Advanced O014 with a deterministic headless sample issue-tracker reset fixture and a dependency-free MCP stdio subset for replaying its allowlisted tools. The server supports initialize/ping/list/call, keeps stdout protocol-only, writes hash evidence to stderr, and stops on unknown tools, mismatches, or incomplete cassettes. Child-process tests exercise the wire format; no host MCP config is bundled or validated, and no model session was started.

The supplied [reference repository](https://github.com/medhu123/amzn_code) listing inspired the documentation structure. Linked contents could not be fetched, so internal practices were not audited or copied.

## Verification

Verification for the latest change: all 45 tests pass serially, including 5 Windows PowerShell runner tests, 5 MCP stdio tests, and 6 simulated-replay/worktree/reset tests. `npm.cmd run check`, both demos, Markdown relative links, JSON fixture/package parsing, and `git diff --check` pass. Codex hook behavior, editor interactions, and the scheduled runner remain host-unvalidated.

Local Markdown targets and whitespace checked. A real editor session and Claude/Codex session remain untested. Claude CLI is not installed; VS Code CLI 1.139.1 is installed, but the current computer-use runtime exposes no app windows or native launch/input API, so the editor UI cannot be exercised in this activation.

The chat heartbeat `chronicle-review-and-improve` is configured every 30 minutes. The optional local Windows runner must not run concurrently against this checkout. Follow [ORCHESTRATION.md](ORCHESTRATION.md) and store findings in [REVIEW.md](REVIEW.md). O013 is verified at fixture level only; consult Git history for publication status.

Scheduled development consumes model usage and requires an available runtime. The runner is not installed as a server or recorder service, and no Scheduled Task was registered. Claude recording hooks remain separately event-driven during an enabled host session.

**Next:** when a supported host runtime is available, follow the removable, no-prompt MCP discovery steps in [GETTING_STARTED.md](GETTING_STARTED.md) and record observed host/version/tool names. In this activation, `Get-Command codex, claude` found neither host CLI; VS Code 1.139.1 is present but `code.cmd --list-extensions` failed with `EPERM` reading `%APPDATA%\Code\User`, and the computer-use app inventory was empty. This blocks host validation here, not a claim about host compatibility. The laptop runner is not registered because the chat heartbeat is still active; do not enable a second writer.

## Open choices

Real Claude/VS Code and Codex host validation, configurable exclusions, retention, SQLite/TypeScript migration, and automatic operation resumption remain outstanding. Codex adapter is fixture-tested only. First slice uses JavaScript and JSON metadata as recorded in D007. Branch output rejects checkpoints with reported exclusions. O006's within-hunk groups are implemented and fixture-verified.

## Next concrete task

Verify local MCP registration/tool discovery for the fixture server in a supported host without starting an agent turn. The stdio subset and scripted worktree demo are not vendor-host integration. O004 still needs a real editor/agent host for event-delivery and UI checks. Keep the laptop runner inactive while the 30-minute chat heartbeat owns this checkout. See [REVIEW.md](REVIEW.md) for evidence and limits.
