# Current handoff

Updated: 2026-10-02.

## State

The user authorized implementation. A dependency-free local prototype now exists: checkpoint engine, CLI, VS Code review panel, and optional Claude Code hook adapter. It is not published, installed as a service, or deployed.

The current direction is a local companion for Codex or Claude Code: record supported file changes, review checkpoints, and apply selected changes without a new model request. See [architecture.md](architecture.md).

## Latest work

- Implemented immutable supported-file capture, byte integrity checks, checkpoint diffs, complete-hunk selection, preview, and separate branch/worktree output.
- Added VS Code commands with preview gating and escaped webview content, plus direct CLI commands.
- Added Claude hook configuration and bounded payload recording for session/tool success/failure boundaries. Attribution remains explicitly uncertain.
- Added the 40-of-80 demo and [GETTING_STARTED.md](GETTING_STARTED.md).
- Updated architecture, decisions, plan, and contribution instructions to reflect actual prototype coverage.

The supplied [reference repository](https://github.com/medhu123/amzn_code) listing inspired the documentation structure. Linked contents could not be fetched, so internal practices were not audited or copied.

## Verification

Latest verification: all 11 tests passed, syntax checks passed, and the demo kept 40 of 80 changed lines. Tests cover original index preservation, dirty baselines, additions/deletions, UTF-8/BOM/CRLF, exclusions, corrupted blobs, invalid selections, lock contention, Git environment overrides, failure journals, and failed-hook payloads. Editor flow is tested with a mocked VS Code host, including preview gating and content escaping.

Local Markdown targets and whitespace checked. A real editor session and Claude session remain untested; Claude CLI is not installed on this machine.

An ACTIVE Codex heartbeat, `chronicle-review-and-improve`, runs on a 30-minute schedule and targets up to about 25 minutes of focused work per activation, carrying on across multiple tasks when time and runtime allow. Codex controls actual duration, and the first scheduled activation has not been verified. Follow [ORCHESTRATION.md](ORCHESTRATION.md) and store findings in [REVIEW.md](REVIEW.md). The user authorized verified commits and normal pushes to origin/main. Check Git status, log, and upstream to determine publication status; this document does not assume a pending push succeeded.

Scheduled development consumes model usage and requires an available runtime. No always-on server or recorder service was deployed. Claude recording hooks remain separately event-driven during an enabled host session. The first scheduled development cycle has not yet been verified.

## Open choices

Real Claude/VS Code integration validation, configurable exclusions, retention, SQLite/TypeScript migration, automatic recovery, undo, and a Codex-specific adapter remain outstanding. First slice uses JavaScript and JSON metadata as recorded in D007. Branch output rejects checkpoints with reported exclusions.

## Next concrete task

First scheduled cycle: review current implementation for actionable correctness and preservation issues. Fix the highest-impact viable finding, or begin O001 capture-gap reporting if the focused review finds none. Run checks, review the resulting diff, update documents, then commit and push verified task-related changes. Real-host validation remains a queue task; unavailable prerequisites must not block independent engine work.
