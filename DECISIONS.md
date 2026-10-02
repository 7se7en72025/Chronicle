# Design decisions

These are design choices, not proof that every feature is implemented. Add entries for durable changes and mark replaced decisions superseded. Actual implementation coverage is in [architecture.md](architecture.md).

## D001 — Stay in the coding workflow

Use a local host adapter and supported editor panel. A VS Code webview is the initial proposed rich surface; native Codex Desktop embedding is unverified. Revisit when a verified host API supports a suitable native interface.

## D002 — Separate selection from agent continuation

Direct review, preview, and Git application make no automatic model requests. Agent chat can consume credits even when invoking a deterministic tool. Optional AI explanations or repairs must be explicit actions.

## D003 — Start with files and hunks

Support regular text files, complete hunks, and contiguous change groups within hunks. Keep replacement lines linked and use unchanged context to separate groups. Do not offer arbitrary individual-line choices that can split replacements; validate the complete preview before apply.

Status: implemented in the prototype; UTF-8 BOM and CRLF output plus linked replacements are fixture-tested. Revisit if a future diff model can prove finer selections safe.

## D004 — Default to a separate worktree

Build baseline plus selection in a separate workspace, preserving the original index and files. A worktree is not a security sandbox. Active-workspace application needs an explicit design with freshness and undo protection.

## D005 — Local storage and visible coverage

Propose SQLite metadata and immutable blobs outside tracked project files. Upload nothing by default. Report unavailable events and uncertain attribution. Sharing needs retention, permissions, and redaction design.

## D006 — Defer full environment replay

Browser, database, and internal agent-state restoration are later scope. File snapshots do not restore remote side effects or agent reasoning. Revisit once file selection works and a specific controlled environment has measurable restoration coverage.

## D007 — Dependency-free first slice

Status: accepted for the prototype.

Use CommonJS JavaScript, built-in Node modules, atomic JSON metadata, content-addressed blobs, and a plain VS Code webview. This temporarily replaces the target TypeScript/SQLite/React stack in the implemented slice.

Reason: prove file selection and preservation behavior without package installation, bundling, or native database friction. The extension and CLI share one engine. Metadata remains small and locally inspectable.

Revisit when: integration behavior is verified and history volume needs querying, schema migration, or a more complex UI. SQLite migration must preserve checkpoint IDs and blob hashes.

## D008 — First host path and conservative output

Status: accepted for the prototype.

Use manual host-neutral checkpoints, Claude CLI hooks, and a Codex CLI plugin-hook adapter with VS Code review. The Codex adapter records supported local lifecycle/tool boundaries; real Codex and Claude sessions remain unverified. Reject output from checkpoints with reported exclusions rather than construct a misleading partial baseline. Failed worktrees remain inspectable; automatic operation resumption is deferred. Guarded undo is scoped separately in D009.

Revisit when: real-host validation and explicit partial-restoration policies are implemented.

## D009 — Scope undo to Chronicle output paths

Status: accepted for the prototype.

Undo only restores the selected paths in a Chronicle-created output worktree to the saved source baseline. It checks branch identity, commit, file bytes and modes, and staged state; it refuses unexpected changes and keeps the branch/worktree. An interrupted undo can resume only when each affected path still matches the operation output or the saved baseline.

Reason: users need a no-model way to reverse a mistaken selection, while later work and unrelated files must remain untouched. Deleting branches/worktrees is a separate explicit cleanup action.

Revisit when: active-workspace mutation or broader operation cleanup is designed with its own recovery and confirmation contract.

## D010 — Keep simulated tool replay fixture-only until a host can safely intercept

Status: accepted for the prototype.

The first replay component accepts bounded schema-versioned JSON cassettes, matches calls in exact order using canonical JSON input hashes, and injects cloned responses from an explicit local-tool allowlist. Mismatches and exhausted recordings fail closed; there is no live-tool fallback. The component does not launch an agent or mutate a workspace.

Reason: response substitution can be tested deterministically without contacting the original service or assuming that an observed hook can intercept a result. Current Codex and Claude hooks are passive recorders in this repository; they cannot provide transparent tool replacement.

Revisit when: a controlled sample app and verified host/orchestrator integration can start a fresh run in an isolated worktree while clearly separating injected, live, and unmatched events.
