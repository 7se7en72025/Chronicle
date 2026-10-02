# Latest development review

Status: reviewed and updated during the first scheduled activation (2026-10-02). This is a single-agent review log, not evidence of independent approval.

## Review scope

Reviewed `src/engine.js`, `src/extension.js`, `src/hook.js`, CLI behavior, tests, and related documentation. Focus: failure coverage, crash-safe blobs, data exposure, user-work preservation, and output correctness.

## Findings

- **P2 — Capture failures disappeared from review history (closed).** `src/hook.js` reported capture exceptions on stderr but did not persist a gap, while `src/engine.js` comparison and the UI had no gap source. Users could misread a quiet timeline as complete. Fixed by storing bounded reason codes and limited event IDs under the local Chronicle store; added the `gaps` CLI command and interval display. Raw command, error, and repository path are excluded from gap records.
- **P1 — Storage path symlinks could redirect snapshots into the repository (closed).** `Chronicle.constructor` only checked the lexical `CHRONICLE_HOME` path. A directory symlink could make an apparently external storage path resolve inside the source repository. The constructor now resolves the nearest existing ancestor before checking the final store path; a regression test verifies a redirected store is rejected before any repository files are created.
- **P1 — Interrupted blob writes could poison a content hash (closed).** `Chronicle.capture` wrote directly to `blobs/<sha256>` with exclusive creation. A crash during the write could leave a partial file at the permanent hash; retries would see EEXIST, fail integrity checking, and never repair the hash. Fixed by fsyncing a unique temporary file then atomically linking it into the content-addressed name. O002 now quarantines crash leftovers instead of deleting them.

The 1,000-event capture-gap cap writes a visible limit marker. Gap persistence is local metadata only and does not improve hook event coverage or make attribution exclusive.

## Fixes and verification

Current verification: all 18 tests passed, `npm run check` passed, `npm run demo` kept 40 of 80 edits with zero model requests, and `git diff --check` passed. New cases cover storage-symlink redirection, atomic blob interruption/retry, quarantining partial files, live/stale locks, unfinished-journal reporting, sanitized busy-capture gaps, interval association, CLI inspection, history cap, and review-panel rendering. A final diff review confirmed recovery preserves user data and refuses live/unreadable locks. Automatic branch/worktree reconciliation, live host integration, and independent review remain outstanding.

## Final review

O001 and O002 behavior is covered through engine, CLI, and mocked editor tests. The first scheduled activation ran this review/fix cycle. Host hook delivery has not been validated in a real Claude session. Recovery preserves all quarantined data; operation journals still need branch/worktree reconciliation.

## Next step

Continue O003 branch-operation recovery. Reconcile journal state with Git worktrees and branches without modifying a user's later edits.
