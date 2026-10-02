# Design decisions

These are design choices, not proof that every feature is implemented. Add entries for durable changes and mark replaced decisions superseded. Actual implementation coverage is in [architecture.md](architecture.md).

## D001 — Stay in the coding workflow

Use a local host adapter and supported editor panel. A VS Code webview is the initial proposed rich surface; native Codex Desktop embedding is unverified. Revisit when a verified host API supports a suitable native interface.

## D002 — Separate selection from agent continuation

Direct review, preview, and Git application make no automatic model requests. Agent chat can consume credits even when invoking a deterministic tool. Optional AI explanations or repairs must be explicit actions.

## D003 — Start with files and hunks

Support regular text files and complete hunks before finer line groups. Replacements and dependent edits can make arbitrary selections invalid. Revisit after patch correctness and recovery are verified.

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

Use manual host-neutral checkpoints and a Claude CLI hook adapter with VS Code review. Codex has no automatic adapter yet. Reject output from checkpoints with reported exclusions rather than construct a misleading partial baseline. Failed worktrees remain inspectable; automatic cleanup, recovery, and undo are deferred.

Revisit when: real-host validation and explicit partial-restoration policies are implemented.
