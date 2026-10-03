# First-release audit

Audited: 2026-10-02; host status refreshed 2026-10-04. Outcome: the local prototype is reviewable; release readiness remains blocked on real host validation. O008 audits the current implementation and does not complete the outstanding milestones in [PLAN.md](PLAN.md).

## Implemented and verified locally

The engine records supported saved UTF-8 files into immutable checkpoints, reports exclusions and recording gaps, and compares checkpoint pairs. Users can choose whole files, hunks, or contiguous change groups, preview complete results, and create an uncommitted branch in a separate worktree. Guarded undo restores selected output paths while refusing later edits, staged changes, and new commits. Interrupted storage is quarantined; branch journals can be reconciled without overwriting work.

Current validation runs on Node.js 24.12.0 and Git 2.52.0.windows.1. The engine/editor test suite, syntax check, and 40-of-80 demo are recorded in [REVIEW.md](REVIEW.md). The demo reports zero model requests. Editor tests use a mocked VS Code API and webview harness; they do not establish native UI behavior.

## Actual host coverage

| Surface | Available behavior | Evidence | Release gap |
| --- | --- | --- | --- |
| Direct Node CLI | Manual capture, compare, select, preview, branch, undo, recovery | Disposable Git tests and runnable demo | Validate the complete user workflow in the supported editor/agent combination |
| VS Code | Development extension with capture, review, and undo commands | Command and webview fixtures; CLI present | Launch, trust, render, keyboard/mouse interaction, opening output, and confirmation in a real Extension Development Host |
| Claude Code CLI | Bundled session and pre/success/failure tool hooks | Payload/privacy/config fixtures | CLI absent; installation, trust, actual event names and failed-tool partial writes unverified |
| Codex CLI | Portable manifest with session, interrupt, and pre/post local tool hooks | Payload/privacy/config fixtures; installed CLI 0.160.0; read-only fixture MCP calls; real session and fixture MCP pre/post-tool checkpoints via temporary inline hooks | Shipped project/plugin trust and loading, Bash/file-edit capture, and broader coverage unverified |
| Codex Desktop native panel | No Chronicle panel integration | No verified rendering API in this project | Use the CLI or VS Code review surface; native embedding is outside the implemented slice |

Official [plugin packaging](https://developers.openai.com/plugins/build/plugins) and [hook documentation](https://learn.chatgpt.com/docs/hooks) were checked during the audit and refreshed for the host status. Plugin installation does not establish hook trust. Project-local hooks also require a trusted project layer; `--dangerously-bypass-hook-trust` is a separate one-off hook-definition option. The 2026-10-02 audit changed no host settings, installations, trust decisions, or model-driven sessions. Later Codex MCP probes used temporary configuration and model turns. A project-local TUI hook probe quit at the persistent project-trust prompt without accepting it. Separate temporary inline session hooks and an MCP-specific tool matcher wrote local checkpoints with `CHRONICLE_HOME` outside the disposable repository; no persistent host settings or trust decisions changed. This proves those narrow boundaries, not the shipped plugin-loading path or its Bash/file-edit matchers. See [REVIEW.md](REVIEW.md).

## Remaining limitations

- Recording excludes ignored files, unsaved buffers, unsupported file types/modes, and the fixed filename policy. Limits are 1 MiB per file and 32 MiB per snapshot. Branch creation refuses captures with reported exclusions.
- Event boundaries do not prove exclusive authorship or complete capture. Codex post-tool events are recorded as observed, including possible failed commands; source-specific coverage must be measured in a real session.
- Change groups follow diff context rather than code dependencies. Review the full preview and run the destination project's checks before treating a selection as correct.
- The source workspace and its index remain separate from output. Captured baseline edits are restored as working-tree contents; staging intent is not recreated.
- Worktrees are not execution sandboxes. Trusted checkout filters can run programs. Keep other writers idle during capture and undo; the filesystem does not provide an atomic multi-file transaction.
- General branch-operation resumption, retention/deletion controls, configurable capture policy, content secret scanning, and encryption are not implemented. Store recordings locally and review capture rules before using sensitive projects.
- Agent reasoning, browser/database state, and remote side effects cannot be restored. The prototype is not marketplace-published or deployed; open-source licensing and any distribution remain separate decisions.

## Next host validation

Resume the remaining O004 host checks when Claude CLI and an actual editor UI runtime are available. Codex CLI session and fixture MCP tool-boundary delivery is already observed with temporary inline hooks; its shipped plugin path still needs a verified local project/plugin trust workflow. In a disposable, text-only Git project, explicitly review the project and hook definition in Codex, then observe an actually executed Bash or file-edit boundary from the shipped matcher and inspect checkpoint/gap evidence. For the complete editor flow, include pre-existing staged and unstaged edits, capture a successful edit and a tool that writes before failing, select a subset through the real panel, verify complete output bytes and the unchanged original index, then exercise guarded undo and its refusal after later edits. Record host versions and observed payload/command behavior without committing private recordings.

The fixture-backed local queue has been advanced through O014; its remaining host/orchestrator acceptance step and O004 still need the prerequisites above. Do not expand the first release or make repetitive unchanged-status commits. See [HANDOFF.md](HANDOFF.md) for current results and [ORCHESTRATION.md](ORCHESTRATION.md) for publication boundaries.
