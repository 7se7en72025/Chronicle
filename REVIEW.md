# Latest development review

Status: first-release local audit completed (2026-10-02); real host validation remains blocked. This is a single-agent review log, not evidence of independent approval.

## Review scope

Reviewed `src/engine.js`, `src/extension.js`, `src/hook.js`, CLI behavior, tests, and related documentation. Focus: failure coverage, crash-safe blobs, data exposure, user-work preservation, and output correctness.

## Findings

- **P2 — Capture failures disappeared from review history (closed).** `src/hook.js` reported capture exceptions on stderr but did not persist a gap, while `src/engine.js` comparison and the UI had no gap source. Users could misread a quiet timeline as complete. Fixed by storing bounded reason codes and limited event IDs under the local Chronicle store; added the `gaps` CLI command and interval display. Raw command, error, and repository path are excluded from gap records.
- **P1 — Storage path symlinks could redirect snapshots into the repository (closed).** `Chronicle.constructor` only checked the lexical `CHRONICLE_HOME` path. A directory symlink could make an apparently external storage path resolve inside the source repository. The constructor now resolves the nearest existing ancestor before checking the final store path; a regression test verifies a redirected store is rejected before any repository files are created.
- **P1 — Interrupted blob writes could poison a content hash (closed).** `Chronicle.capture` wrote directly to `blobs/<sha256>` with exclusive creation. A crash during the write could leave a partial file at the permanent hash; retries would see EEXIST, fail integrity checking, and never repair the hash. Fixed by fsyncing a unique temporary file then atomically linking it into the content-addressed name. O002 now quarantines crash leftovers instead of deleting them.
- **P2 — Interrupted branch journals had no state-to-worktree view (closed for safe reconciliation).** `recoverStorage` listed non-completed journal JSON but did not compare it with Git's local branch refs and registered worktrees. Users could not tell whether an `applying` result existed or had later edits. Added read-only `reconcileOperations()` and CLI output for prepared/applying/failed/completed journals, reporting mismatches and retained paths. Completed outputs store expected file hashes and deleted paths, so reconciliation detects later edits without misclassifying the intended uncommitted branch result as user modification. It preserves the journal and worktree; resuming or cleaning operations remains manual.
- **P2 — No Codex hook adapter despite supported local hook events (closed at fixture level).** Verified the official Codex hook schema and local coverage for `PreToolUse`/`PostToolUse`, session events, and interrupts. Added a separate Codex hook config selected by `plugin.json`, and adapted the shared recorder without saving prompt/tool payloads. The current Codex docs have no `PostToolUseFailure` event; `PostToolUse` also fires after non-zero Bash exits, so Chronicle records its status as `observed`. Config packaging and event fixtures pass; a real CLI session remains unverified.

The 1,000-event capture-gap cap writes a visible limit marker. Gap persistence is local metadata only and does not improve hook event coverage or make attribution exclusive.

## Fixes and verification

Before the third activation, verification stood at 22 tests, `npm run check`, the 40-of-80 demo, JSON parsing, Markdown links, and whitespace. Current undo-specific final verification is recorded below.

## Final review

O001–O003 remain covered through engine, CLI, and mocked editor tests. O007's Codex adapter is verified against official hook event docs and fixtures, not a running Codex host. O004 remains blocked: Claude CLI is absent, and the computer-use runtime returned no app windows and exposes no native launch API even though VS Code CLI is installed. Completed journals predating the expected-file manifest are explicitly reported as unverified. Output undo is now guarded and can resume after validating partially restored paths; general operation resumption remains manual.

## Third activation — guarded output undo (2026-10-02)

**P1 — No way to reverse a mistaken Chronicle branch selection without manually editing its output (closed).** `src/engine.js:createBranch` retained source checkpoints and result manifests but exposed no inverse operation. Added `undoOperation` scoped to a journal-validated Chronicle worktree. It validates operation identity, branch/HEAD, selected-path staging, and affected bytes/modes against the selected result before restoring the source checkpoint. It leaves other paths, the original workspace, branch, and worktree intact. Undo journals `undoing` before writes and permits recovery only when each path matches either expected output or saved baseline; branch tip, staging, and each path are checked again immediately before mutation. Unexpected edits, staged changes, new commits, broken worktree registration, or invalid manifests fail closed.

Added CLI `undo <operation-id>` and a modal-confirmed VS Code command. Tests cover source and unrelated-path preservation, later edits, staged paths, committed output, partial undo recovery, and added/deleted files. The native UI remains unverified.

**Verification:** `npm test` passes (25 tests), `npm run check` passes, `npm run demo` keeps 40 of 80 edits with zero model requests, Markdown relative links resolve, `package.json` parses, and `git diff --check` passes. Tests cover clean undo, add/delete restoration, independent file preservation, edits, staged paths, new commits, partial undo recovery, and the mocked VS Code confirmation path. Independent review was not performed.

**Remaining concerns:** per-file replacement uses a same-directory temporary file and atomic rename, so interruption before replacement leaves the selected result intact. A crash can leave that temporary sibling for manual inspection. Filesystem writes cannot be atomic against an unrelated process changing the same file at precisely the same time; Chronicle rechecks each path immediately before restore and journals partial progress. Keep Chronicle idle during undo. Undo restores saved file bytes only; it does not restore agent state, remove the branch/worktree, or reverse external side effects.

**Final second pass:** reviewed the operation guard, atomic same-directory restore, confirmation flow, tests, and all related docs. Checks passed: 25 tests, syntax, demo, Markdown links, package JSON, and whitespace. No independent reviewer participated. Implementation commit `98f3c4d` is pushed to `origin/main`; matching handoff and review publication notes follow. O005 is verified at prototype scope.

**Next:** advance O006, finer change-group selection. Resume O004 only when real host/UI access becomes available.

## Fourth activation — within-hunk selection (2026-10-02)

**P2 — Users could only choose an entire Git hunk even when it contained separate edits (closed).** `src/engine.js:compare` exposed each Git hunk as one selection ID, and `preview` replaced the whole hunk's line range. This prevented keeping one nearby edit while discarding another without asking the agent to regenerate it.

Added linked change groups by parsing the hunk's `-`, `+`, and unchanged-context rows. A contiguous replacement remains one group; unchanged context separates groups. `preview` accepts either legacy hunk IDs or group IDs and reconstructs the result from immutable checkpoint line slices. UI shows group choices only where a hunk has multiple groups. Added tests for two independent edits in a single hunk, linked two-line replacements, standalone insertions/deletions, selected-branch output, BOM/CRLF preservation, and UI rendering and parent/child selection events. Full-suite results are recorded below.

**Remaining concerns:** grouping is diff-context-based, not semantic dependency analysis. Changes without unchanged context remain one group; code may still depend on unselected edits. Users must review the complete preview. Capture remains UTF-8 text only.

**Final second pass:** verified hunk offsets against patch context counts, replacement grouping, standalone insertion/deletion groups, stale-pair IDs, and overlap-safe reconstruction from saved source/result lines. Reviewed UI parent/child checkbox behavior; selecting a child clears the hunk selection, and changing a hunk clears child choices. The event behavior is exercised in the VS Code webview harness. All 27 tests, syntax check, 40-of-80 demo, Markdown links, package JSON, and whitespace checks pass. No independent agent reviewed this change. O006 is verified at prototype scope; the second-host portion of milestone 4 remains blocked by O004.

**Next:** O008 first-release audit. Keep O004's host validation blocked until a real host/UI runtime is available.

## First-release audit (2026-10-02)

**P1 — User Git formatting can hide changes or corrupt group offsets (closed).** `src/engine.js:compare` inherited global `color.ui=always` and `diff.suppressBlankEmpty=true`. Colored hunk headers were not recognized; omitted blank-context prefixes prevented `changeGroups` from counting unchanged lines. A disposable subprocess with an isolated Git home reproduced the missing hunks before the fix. Internal diff commands now force `--no-color` and `diff.suppressBlankEmpty=false`; missing hunk headers fail closed. The regression verifies two separate groups, both partial previews, correct blank-line offsets, and selected branch bytes under that configuration.

**P2 — Codex installation claim is stale (closed).** `GETTING_STARTED.md` said Codex CLI was not installed. This audit found `codex-cli 0.159.2` on PATH and corrected current docs. Version/help output establishes installation only; plugin loading, trust, actual hook execution, and UI interaction remain unverified. Historical earlier-activation evidence remains historical.

**P2 — Undo confirmation omits the branch name (closed).** `src/extension.js` read `selected.branch` from a QuickPick item whose operation is stored as `selected.op`. The dialog displayed `undefined` instead of the selected branch. It now reads `selected.op.branch`; the editor harness asserts the actual confirmation text before the guarded undo.

**Audit outcome:** [RELEASE_AUDIT.md](RELEASE_AUDIT.md) lists implemented local behavior, each host's evidence level, privacy/restoration boundaries, and a disposable-project procedure for O004. O008 is complete at local audit scope; no release or marketplace publication is claimed. Claude remains absent; Codex CLI is installed, but its real plugin/hook workflow and the VS Code UI remain unverified. Official plugin and hook docs were revisited without changing host settings or launching model-driven sessions.

**Verification:** `npm test` passes all 28 tests; `npm run check` passes; `npm run demo` keeps 40 of 80 edits with zero model requests. Documentation link/JSON/whitespace checks and the second diff review are recorded below. No independent review was performed.

**Final second pass:** inspected the complete code/test/documentation diff and the new audit. The regression uses an isolated child-process Git home, preserving the real Git configuration and index. Diff parsing now normalizes both known formatting hazards and refuses missing headers; undo confirmation uses the same operation selected for restore. All 66 relative Markdown links resolve, six tracked/config JSON files parse, and `git diff --check` passes. Host claims distinguish CLI availability from real hook/UI evidence. No additional finding remains actionable within the current available queue.

**Next:** no currently viable queue task remains. Keep O004 blocked until its host/UI prerequisites are available. Resume the audit's real-host procedure then; preserve the current scope and avoid repetitive unchanged-status updates.
