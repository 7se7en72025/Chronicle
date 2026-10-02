# Latest development review

Status: reviewed and updated during the second scheduled activation (2026-10-02). This is a single-agent review log, not evidence of independent approval.

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

Current verification: all 22 tests passed, `npm run check` passed, `npm run demo` kept 40 of 80 edits with zero model requests, both Codex JSON files parse, Markdown relative links resolve, and `git diff --check` passed. Reconciliation coverage includes clean completed output (still Git-dirty by design), post-completion edits including recreated deletions, prepared-after-worktree-creation, applying/interrupted, failed branch collision, CLI reporting, and preservation of edits in interrupted worktrees. Codex coverage includes privacy-safe before/after payload fixtures and plugin hook config shape. Live host integration and independent review remain outstanding.

## Final review

O001–O003 remain covered through engine, CLI, and mocked editor tests. O007's Codex adapter is verified against official hook event docs and fixtures, not a running Codex host. O004 remains blocked: Claude CLI is absent, and the computer-use runtime returned no app windows and exposes no native launch API even though VS Code CLI is installed. Completed journals predating the expected-file manifest are explicitly reported as unverified. Chronicle does not automatically resume interrupted operations or implement undo.

## Next step

Next, investigate guarded undo (O005) and actual host availability for O004. Do not mark either verified without destination freshness/conflict tests or a real host session.
