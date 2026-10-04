# First-release audit

Audited: 2026-10-02; host status refreshed 2026-10-04. Outcome: the local prototype is reviewable; release readiness remains blocked on real host validation. O008 audits the current implementation and does not complete the outstanding milestones in [PLAN.md](PLAN.md).

## Implemented and verified locally

The engine records supported saved UTF-8 files into immutable checkpoints, reports exclusions and recording gaps, and compares checkpoint pairs. Users can choose whole files, hunks, or contiguous change groups, preview complete results, and create an uncommitted branch in a separate worktree. Guarded undo restores selected output paths while refusing later edits, staged changes, and new commits. Interrupted storage is quarantined; branch journals can be reconciled without overwriting work.

Current validation runs on Node.js 24.12.0 and Git 2.52.0.windows.1. The engine/editor test suite, syntax check, and 40-of-80 demo are recorded in [REVIEW.md](REVIEW.md). The demo reports zero model requests. Editor tests use a mocked VS Code API and webview harness; they do not establish native UI behavior.

## Actual host coverage

| Surface | Available behavior | Evidence | Release gap |
| --- | --- | --- | --- |
| Direct Node CLI | Manual capture, compare, select, preview, branch, undo, recovery | Disposable Git tests and runnable demo | Validate the complete user workflow in the supported editor/agent combination |
| VS Code | Development extension with capture, review, and undo commands | Command and webview fixtures; VS Code CLI 1.140.0 and `--list-extensions` work; current desktop inventory exposes no targetable app/window | Launch, trust, render, keyboard/mouse interaction, opening output, and confirmation in a real Extension Development Host |
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

On 2026-10-04, the VS Code CLI reported version 1.139.1 and successfully listed installed extensions, but the supported computer-use helper could not connect its native pipe after its prescribed retries. No UI window was launched. CLI availability does not validate the Extension Development Host; see [REVIEW.md](REVIEW.md).

A later read-only check on 2026-10-04 reports VS Code CLI 1.140.0. The current CUA state lists no apps or browsers, and the documented `listApps`/`listWindows` calls are undefined in the runtime. No Chronicle extension appears in `code.cmd --list-extensions`, and no UI window was launched. The app listing alone cannot distinguish an inactive desktop session from an unavailable helper; real editor validation remains open. See [REVIEW.md](REVIEW.md).

On 2026-10-05, a read-only check confirmed Codex CLI 0.160.0 and found the locally installed/enabled test package had drifted since its installation: `plugin.json` and `hooks/codex-hooks.json` still match the repository, but `src/hook.js` and `src/engine.js` do not. In particular, the installed hook retains raw exception-text logging removed from current `main`. No shipped callback was run. Rebuild a distinct current test package and use the official [`/hooks` review and trust flow](https://learn.chatgpt.com/docs/hooks#review-and-trust-hooks) before host testing; do not refresh the enabled copy in place or bypass trust. The STOP marker remains untouched.

After the user authorized a disposable test, a second local marketplace and source-matched plugin build from commit `0b55358` were added without altering the stale copy. Codex CLI showed both test plugin entries as enabled, but its `/hooks` page showed zero installed/active hooks for all events on both a default TUI launch and one ephemeral `features.hooks=true` launch. The fixture repo was trusted through Codex's project prompt; the Chronicle hook was neither listed nor trusted, no model prompt was sent, and no event store was written. Hook delivery remains unverified; diagnose enumeration before another host run.

The 2026-10-04 initial local host audit found no installed Chronicle plugin and a failing Codex doctor disk check with about 146 MiB free on C: at inspection. On a later same-day check, C: had about 11.6 GiB free, `codex doctor --summary` passed, and a disposable local marketplace package was registered and installed/enabled. SHA-256 comparisons matched all seven copied plugin/adapter files to the repository. The user has not yet reviewed/trusted the installed hook definition, so no shipped hook callback was executed and no hook-delivery claim changed. The scheduled runner's `%LOCALAPPDATA%\Chronicle\runner\STOP` marker remains untouched. See [REVIEW.md](REVIEW.md).

The fixture-backed local queue has been advanced through O014; its remaining host/orchestrator acceptance step and O004 still need the prerequisites above. Do not expand the first release or make repetitive unchanged-status commits. See [HANDOFF.md](HANDOFF.md) for current results and [ORCHESTRATION.md](ORCHESTRATION.md) for publication boundaries.
