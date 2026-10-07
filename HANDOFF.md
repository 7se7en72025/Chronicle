# Current handoff

Updated: 2026-10-07.

## Current state and verification

Chronicle is an unpublished local prototype: checkpoints, coverage warnings, hunk/change-group selection, separate worktree output, guarded undo, branch comparison, and bounded simulated replay evidence are implemented. Direct local review and application do not request a model. First-release acceptance remains incomplete; see [PLAN.md](PLAN.md), [architecture.md](architecture.md), and [ORCHESTRATION.md](ORCHESTRATION.md).

Earlier source fixes reconciled Windows worktree aliases through non-following BigInt filesystem identities and preserved the caller's repository-root spelling for storage keys while validating Git identity. Their [CI run 37334567677](https://github.com/7se7en72025/Chronicle/actions/runs/37334567677) passed Node 22/24 on Ubuntu and Windows. That CI result predates the current timestamp-order change; details remain in [REVIEW.md](REVIEW.md).

The previous handoff consolidation changed documentation only and established no additional host coverage.

The syntax check now discovers JavaScript files recursively under `src/` and `scripts/`; `npm run check` passes across all 15 files. The complete test suite passed immediately before this maintenance change (109 passed, 3 platform-specific skips, 0 failures).

The boundary warning scan now refuses a matching post timestamp older than its pre checkpoint, preventing reused IDs in earlier history from hiding later missing outcomes. Focused tests pass 3/3; the full suite passes 110/113 with three Linux-only skips and zero failures, syntax checks pass for 15 JavaScript files, and documentation/whitespace checks pass. This does not establish complete capture or causal ordering under clock changes.

Saved branch comparison now validates fixture journal shape and identity before binding lookup and refuses non-object events. Damaged JSON records hide fixture provenance without crashing file comparison; the focused regression passes and the full suite passes 110/113 (three Linux-only skips, zero failures); syntax, 145 documentation links, and whitespace checks pass. See REVIEW.md for evidence.

Fixture binding now refuses malformed UUID-named journals during duplicate scans before updating the target run. Focused integration passes; the full suite passes 110/113 with three Linux-only skips and zero failures. Syntax, 145 documentation links, and whitespace checks pass. Damaged records stay available for inspection; see REVIEW.md.

## Remaining acceptance gates

- O004/O007: validate the exact shipped Codex package through normal reviewed/trusted loading, Bash and partial-write boundaries, privacy, and source/index preservation. Temporary inline hooks and a disposable compatibility-manifest package observed callbacks; portable root-manifest packages produced no checkpoints in their fixture turn. These are distinct integration paths.
- Editor/second host: exercise the real VS Code Extension Development Host review/select/preview/apply/undo workflow and refusals. The native Windows computer-use connection now exposes the Chronicle VS Code window, but selecting it returns "Computer Use was not approved to use Visual Studio Code." App approval is pending; the other connection still returns an empty inventory. A fresh CLI extension list has no Chronicle extension; Claude host validation remains open. Mocked tests and CLI inventory do not satisfy acceptance.
- O014: fixture replay/evidence contracts are implemented; exhaustive host tool interception and fresh agent branch binding remain unverified. Pre-witness child death is ambiguous. Sidecar-ahead recovery stays failed-only and separate under [D014](DECISIONS.md). Do not label fixture evidence complete environment replay.

[upgrades.md](upgrades.md) owns the accepted roadmap; [learnings.md](learnings.md) distinguishes research implications from verified behavior. Browser/OS replay, hosted collaboration, and hidden agent-state restoration remain deferred.

## Execution and preservation

The optional laptop runner remains behind its existing STOP marker. Do not clear it or start another writer; an earlier automatic approval review rejected clearing that marker. Scheduled chat activations are runtime-dependent and do not guarantee continuous overnight execution. Follow current activation instructions and [ORCHESTRATION.md](ORCHESTRATION.md), rather than historical heartbeat status in old review entries.

Preserve unrelated untracked `BOLPREP.md`, existing staging, private recordings, and credentials. Normal verified commits and pushes to the authorized origin/main remain permitted; no force pushes or history rewrites.

## Current execution direction

The user authorized skipping VS Code for ongoing work. Continue CLI review and viable local fixes; keep real editor validation pending rather than treating app approval as a prerequisite for all development. The CLI now refuses coerced exit-code arguments that could create false reported passes. Focused and full verification pass: 110 tests passed, three Linux-only skips, zero failures; syntax, links, and whitespace pass.

The Codex boundary warning scan now includes saved turn ID in its correlation key. A post event from another turn no longer hides a missing outcome when session and tool IDs are reused. The regression failed before the change; four focused boundary tests pass afterward. The full suite passes 111/114 with three Linux-only skips and zero failures; syntax, 146 Markdown links, and whitespace checks pass. See [REVIEW.md](REVIEW.md).

The scan now also counts repeated pre-tool checkpoints separately and consumes each matching post once. A regression reproduced the old undercount; five focused boundary tests and syntax pass after the fix. The full suite passes 112/115 with three Linux-only skips and zero failures; 147 Markdown links and whitespace checks pass. See [REVIEW.md](REVIEW.md).

The latest fix orders saved checkpoint and gap review, plus Codex pre/post matching, by parsed timestamp. A regression with valid timezone offsets reproduced an incorrect warning count before the change. Focused tests pass 5/5; the full suite passes 114/117 with three platform-specific skips and zero failures. Syntax, 148 relative Markdown links, and whitespace checks pass. See [REVIEW.md](REVIEW.md).

Codex pre/post correlation now includes the saved tool name. A wrong-tool post with reused IDs previously hid a missing outcome; the regression failed before the fix and six focused boundary tests now pass. Full-suite verification passes: 116 of 119 tests, three platform-specific skips, zero failures. Syntax, 149 relative Markdown links, and whitespace checks pass. See [REVIEW.md](REVIEW.md).

Unknown CLI commands now fail before initializing repository or storage state; disposable tests cover both repository and non-repository invocation. Focused and syntax checks pass; the full suite passes 116 of 119 tests with three platform-specific skips and zero failures.

The README and setup guide now match the later compatibility-package fixture evidence in the release audit. This documentation update establishes no new host coverage; normal shipped-package loading and the remaining acceptance gates are still open.

Simulated replay canonicalization now rejects sparse JavaScript arrays, preventing a malformed local request from matching an empty-array cassette input and consuming its response. The regression failed before the fix; seven focused tests pass. The full suite passes 117 of 120 tests with three platform-specific skips and zero failures; syntax, 151 relative Markdown links, and whitespace checks pass. Host coverage remains unchanged. See [REVIEW.md](REVIEW.md).

## Latest verified fix

The Codex trace inspector keeps coverage unknown when turn.completed is absent, even with matching fixture-server evidence. The regression reproduced the old valid-structure flag; focused tests and syntax pass. The earlier full suite failed with timeouts and missing disposable storage after a reported multi-hour duration; a fresh rerun passed 117 of 120 tests with three platform-specific skips and zero failures in about 247 seconds. No runner or recovery code changes were needed; the earlier cause remains unconfirmed. Documentation and whitespace checks pass. See [REVIEW.md](REVIEW.md) for both results. Host acceptance gates remain open.
## Next concrete task

Prioritize the open executable-mode freshness finding in [REVIEW.md](REVIEW.md): completed output reconciliation checks bytes but not saved POSIX executable modes. Reproduce mode-only drift in a disposable Linux fixture, require evidence attachment refusals, then fix against manifest.outputFiles modes with conservative legacy handling. This is source-review evidence; no Linux reproduction or fix is claimed yet. Ubuntu-24.04 WSL is available and has Git, but Node is absent from PATH and the checked runtime/cache directories. Acquire a maintained Linux Node runtime before the POSIX regression; do not substitute Windows Node.


Continue viable CLI work within the accepted scope. When Visual Studio Code is approved and the shipped hook reviewed/trusted, run disposable real-host acceptance procedures and record checkpoints, gaps, privacy, and preservation evidence. Until those prerequisites exist, review concrete defects within the accepted scope. Do not invent roadmap work or repeat unchanged checks to fill a cycle.
