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

## D010 — Route cassette replay through fixture-owned tools

Status: accepted for the prototype.

The replay fixture accepts bounded schema-versioned JSON cassettes, matches calls in exact order using canonical JSON input hashes, and injects cloned responses from an explicit local-tool allowlist. A dependency-free MCP stdio prototype exposes only those read-only fixture tools. Mismatches and incomplete recordings fail closed; there is no live-tool fallback. It does not launch an agent, connect to a host, or mutate a workspace.

Reason: an explicitly owned fixture tool can return a saved response before any external operation occurs, while keeping the initial experiment deterministic and consistent with D007's dependency-free prototype. Official Claude/Codex hooks can affect model-visible post-tool output after the real tool already ran, so they do not alone provide side-effect-free replay.

Revisit when: the stdio subset is validated with a real supported host, and a controlled orchestrator can start fresh runs in isolated worktrees while clearly separating injected, live, and unmatched events. Revisit the SDK choice before expanding protocol support.

## D011 — Correlate replay evidence through a controller-owned run

Status: accepted design; in-process and controlled subprocess fixture runs can be checked and bound at fixture level. Host observation and interruption recovery remain unimplemented.

Assign a random run ID before fixture tools start. The controllers pin the cassette hash and source state, sequence bounded local evidence, and create one candidate branch before checked binding. The in-process path records session completion; the controlled subprocess path also records process exit. Reused fixture IDs and independent MCP stderr records are insufficient to identify an operation. Reject stale or ambiguous bindings without rewriting the operation journal. Treat live-tool activity as unavailable unless the controller or host separately observes it; a rejected fixture call is not proof of a live fallback.

Reason: direct `createBranch` has no shared identifier with an independently started fixture MCP process. Attaching uncorrelated stderr events would make a branch manifest appear to prove tool provenance it cannot establish. The controllers create their own candidate operation and store the binding in the run record, not the branch manifest. The remaining interruption and host boundary is in [architecture.md](architecture.md#proposed-fixture-run-and-branch-correlation-contract).

Revisit for durable subprocess interruption recovery or host event IDs and lifecycle guarantees.
