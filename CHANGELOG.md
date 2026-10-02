# Changelog

Record meaningful changes. Implementation, verification, and deployment are separate claims.

## Unreleased

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
