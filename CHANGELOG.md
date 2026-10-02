# Changelog

Record meaningful changes. Implementation, verification, and deployment are separate claims.

## Unreleased

### 2026-10-02 — Autonomous development workflow

- Added a concrete autonomous task queue with verification criteria, handoff updates, and scope boundaries.
- Defined a review → fix → tests → final review cycle, with findings and evidence stored in REVIEW.md.
- Configured ACTIVE heartbeat `chronicle-review-and-improve`, every 30 minutes, with user-authorized commits and normal pushes after verification. First scheduled execution is not yet verified. Runtime availability and model usage remain constraints; no always-on server was deployed.
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
