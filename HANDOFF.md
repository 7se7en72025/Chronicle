# Current handoff

Updated: 2026-10-02.

## State

The user authorized implementation. A dependency-free local prototype now exists: checkpoint engine, CLI, VS Code review panel, and optional Claude Code hook adapter. It is not published, installed as a service, or deployed.

The current direction is a local companion for Codex or Claude Code: record supported file changes, review checkpoints, and apply selected changes without a new model request. See [architecture.md](architecture.md).

## Latest work

- Added the research-backed [upgrade roadmap](upgrades.md) and [learnings](learnings.md); clarified current versus proposed capabilities in [architecture.md](architecture.md). Five primary papers inform the recommendations; replay and environment-restore claims are explicitly bounded.
- Completed O008's [first-release audit](RELEASE_AUDIT.md). Fixed Git color/blank-context settings breaking selection and the undo confirmation's missing branch name. Actual host/UI validation remains outstanding; installed Codex CLI 0.159.2 was checked through version/help only.

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
- Added **Chronicle: Compare Saved Branches** in VS Code; it compares two selected completed manifests without executing checks or agents. O011 is under test; explicit user-run check-result recording is queued as O012.
- Added `record-check` for developer-reported check labels and exit codes; it does not run or verify project commands. O012 is verified at CLI/editor-fixture level.

The supplied [reference repository](https://github.com/medhu123/amzn_code) listing inspired the documentation structure. Linked contents could not be fetched, so internal practices were not audited or copied.

## Verification

Latest verification: all 29 tests pass, including branch manifest comparisons, reported check pass/fail validation, CLI serialization, and VS Code comparison rendering/escaping. `npm run check`, the 40-of-80 `npm run demo`, local Markdown links, package JSON parsing, and `git diff --check` pass. Full results and second-pass diff review are in [REVIEW.md](REVIEW.md). Codex hook behavior and editor interactions remain fixture-tested, not host-validated.

Local Markdown targets and whitespace checked. A real editor session and Claude/Codex session remain untested. Claude CLI is not installed; VS Code CLI 1.139.1 is installed, but the current computer-use runtime exposes no app windows or native launch/input API, so the editor UI cannot be exercised in this activation.

An ACTIVE Codex heartbeat, `chronicle-review-and-improve`, runs on a 30-minute schedule and targets up to about 25 minutes of focused work per activation, carrying on across multiple tasks when time and runtime allow. The first scheduled review activation ran on 2026-10-02; its actual duration is runtime-controlled. Follow [ORCHESTRATION.md](ORCHESTRATION.md) and store findings in [REVIEW.md](REVIEW.md). O006 is verified; consult the current Git history for publication status.

Scheduled development consumes model usage and requires an available runtime. No always-on server or recorder service was deployed. Claude recording hooks remain separately event-driven during an enabled host session.

## Open choices

Real Claude/VS Code and Codex host validation, configurable exclusions, retention, SQLite/TypeScript migration, and automatic operation resumption remain outstanding. Codex adapter is fixture-tested only. First slice uses JavaScript and JSON metadata as recorded in D007. Branch output rejects checkpoints with reported exclusions. O006's within-hunk groups are implemented and fixture-verified.

## Next concrete task

O010–O012 are verified at their documented levels. O013 is next: version the privacy-bounded shared event evidence contract for host adapters. O004 still needs a real editor session; Claude CLI is absent, while Codex CLI plugin trust and hook delivery remain unverified. The ACTIVE heartbeat will continue the roadmap queue. See [upgrades.md](upgrades.md) for research-backed sequencing and [REVIEW.md](REVIEW.md) for current verification.
