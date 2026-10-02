# Current handoff

Updated: 2026-10-02.

## State

The user authorized implementation. A dependency-free local prototype now exists: checkpoint engine, CLI, VS Code review panel, and optional Claude Code hook adapter. It is not published, installed as a service, or deployed.

The current direction is a local companion for Codex or Claude Code: record supported file changes, review checkpoints, and apply selected changes without a new model request. See [architecture.md](architecture.md).

## Latest work

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

The supplied [reference repository](https://github.com/medhu123/amzn_code) listing inspired the documentation structure. Linked contents could not be fetched, so internal practices were not audited or copied.

## Verification

Latest verification: all 25 tests pass, including guarded undo conflicts, partial recovery, file additions/deletions, and mocked VS Code confirmation. `npm run check`, the 40-of-80 `npm run demo`, Markdown relative links, `package.json` parsing, and `git diff --check` pass. Codex hook behavior is fixture-tested; editor interactions remain mocked.

Local Markdown targets and whitespace checked. A real editor session and Claude/Codex session remain untested. Claude CLI is not installed; VS Code CLI 1.139.1 is installed, but the current computer-use runtime exposes no app windows or native launch/input API, so the editor UI cannot be exercised in this activation.

An ACTIVE Codex heartbeat, `chronicle-review-and-improve`, runs on a 30-minute schedule and targets up to about 25 minutes of focused work per activation, carrying on across multiple tasks when time and runtime allow. The first scheduled review activation ran on 2026-10-02; its actual duration is runtime-controlled. Follow [ORCHESTRATION.md](ORCHESTRATION.md) and store findings in [REVIEW.md](REVIEW.md). Latest verified implementation was committed as `98f3c4d` and pushed to `origin/main`; this handoff records that result.

Scheduled development consumes model usage and requires an available runtime. No always-on server or recorder service was deployed. Claude recording hooks remain separately event-driven during an enabled host session.

## Open choices

Real Claude/VS Code and Codex host validation, configurable exclusions, retention, SQLite/TypeScript migration, automatic operation resumption, and finer selection remain outstanding. Codex adapter is fixture-tested only. First slice uses JavaScript and JSON metadata as recorded in D007. Branch output rejects checkpoints with reported exclusions.

## Next concrete task

O001–O003 and O005 are verified at their documented levels; O007 remains fixture-level. `undo <operation-id>` restores only selected paths in Chronicle output after checking branch, staged state, bytes, and modes. It can resume an interrupted undo and refuses later edits. O004 remains blocked on Claude CLI and desktop UI access. Next, advance O006, finer change-group selection; keep O004 blocked until a real host/UI runtime is available.
