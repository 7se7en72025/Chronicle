# Latest development review

Status: first-release local audit completed; roadmap execution is active. Real host validation remains blocked. This is a single-agent review log, not evidence of independent approval.

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

## User-requested research and upgrade documentation (2026-10-02)

**Outcome:** read five primary research papers and added [learnings.md](learnings.md) and [upgrades.md](upgrades.md); expanded [architecture.md](architecture.md) with the implemented branch behavior, non-implemented destination application, and explicit inspect/select/fresh-retry/simulated-or-full-replay levels. The sources cover failure reproduction (ReCrash), coding-agent interfaces (SWE-agent), cross-file task complexity (SWE-bench), controlled web-agent environments (BrowserGym), and evaluation validity (AgentSuite). Recommendations are clearly identified as Chronicle design inferences; paper results are not described as proof of Chronicle functionality.

**Final review:** verified the roadmap orders real host validation before comparison/replay scope, fresh retries are labeled model/tool-consuming, and simulated tools are kept inside a controlled fixture. No claim of exact agent-state or arbitrary external-action restoration was added. Updated README entry points, changelog, handoff, and queue. Documentation-only checks pass: 86 relative Markdown links resolve, six JSON files parse, and `git diff --check` is clean. Application tests were not run because no application code changed. O009 is complete at documentation scope.

**Next:** the latest roadmap implementation and verification are recorded below. O004 still requires real host/UI access.

## Roadmap activation — O010 evidence manifests and comparison (2026-10-02)

**P2 — Completed branches lacked comparable per-operation evidence (closed for the CLI/file layer).** `src/engine.js:createBranch` journaled selected IDs and output hashes but did not persist a versioned manifest with source, measured environment, or coverage, and no read-only comparison existed. Added schema-1 manifests and `compareOperations`; `src/cli.js` exposes `compare-operations`. The report categorizes saved paths as added/deleted/changed/identical. It explicitly leaves checks empty and cost unavailable; it does not imply tests ran. Visual comparison and measured check results are queued in O011.

The regression fixture creates two distinct selections and verifies changed, added, deleted, and identical output paths, plus source/selection/environment fields and unavailable checks/cost. It rejects comparing one operation to itself and invokes the CLI to confirm serialized output. The first parallel full-suite run hit the machine's low remaining temporary space (about 1.1 GB free) and exposed a reversed directional expectation; after correcting it, the suite was rerun serially.

**Verification:** the serial suite passes all 29 tests; syntax check and demo pass; demo retains 40/80 selected lines with 0 model requests. Fifteen Markdown files' relative links resolve, package JSON parses, and `git diff --check` passes.

**Second-pass review:** manifest values are taken from the selected saved checkpoint pair, verified output files, and measured runtime; prompt/tool payloads are not copied. Same-operation comparison is rejected. The test exercises directional added/deleted plus changed/identical classifications and CLI serialization. Checks are explicitly empty and cost null. Visual comparison, command/check execution capture, and reported check exit status remain unimplemented. The first parallel test attempt hit `ENOSPC` when fixture creation tried to copy Git templates; the serial rerun passed after fixture cleanup. No independent review was performed.

**Next:** O010 and O011 are verified at their documented levels. O012 is the next task: define user-invoked check evidence without automatic arbitrary command execution. Resume O004 only with real host/UI access.

## Roadmap activation — O011 VS Code branch comparison (2026-10-02)

Added the `chronicle.compareOperations` command. It asks the developer to choose exactly two completed operations with schema-1 manifests, calls the read-only engine comparison, then opens a script-disabled VS Code panel with both branches' measured runtime/coverage/check/cost facts and a path-by-path status/hash/mode table. All stored branch names, paths, and values are escaped. It does not execute tests, agent runs, or other workspace commands.

The mocked editor test creates two completed branches, selects them through the multi-pick flow, verifies the view shows both saved outputs and labels checks/cost unavailable, then exercises hostile branch/path escaping and CSP. Full `npm test -- --test-concurrency=1` passes all 29 tests; `npm run check`, 40/80 demo, 15-file relative Markdown links, package JSON parse, and `git diff --check` pass. The test suite was serial because the host reported only about 1.1 GB temporary disk space; no cleanup outside test-owned fixtures was performed.

**Second-pass review:** comparison is read-only; `enableScripts: false` and `default-src 'none'` prevent active content, local resources are disabled, and the only style uses a generated nonce. The output is directional from the first saved branch to the second and compares exact saved hashes and modes. Cost and checks are unavailable because current manifests do not contain measured values. Real VS Code UI integration remains blocked by O004; this is not host proof. No independent reviewer participated.

## Roadmap activation — O012 user-reported check evidence (2026-10-02)

**P2 — Branch comparison had no place to record checks run by the developer (closed at local evidence scope).** Added `Chronicle.recordCheck` and CLI `record-check <operation-id> <exit-code> <label>`. It accepts only completed schema-1 operations, one-line bounded labels and exit codes 0–255, caps records at 100, and appends a timestamp, source `user-reported`, exit code, and explicitly reported outcome. Chronicle does not execute a command or establish that the claimed command was actually run. The VS Code comparison panel lists check labels/outcomes/source with normal escaped rendering. Costs remain unavailable.

Tests cover reported pass and nonzero outcomes, invalid exit/line inputs, CLI serialization, comparison rendering of both operation check reports, and HTML escaping. First attempted `npm` invocation was blocked because PowerShell resolved `npm.ps1` under a restricted execution policy; reran through `npm.cmd`. Full suite passes: 29/29. `npm run check`, demo (40/80, zero model requests), 15 Markdown relative-link checks, package JSON parsing, and `git diff --check` pass.

**Second-pass review:** operation ID is validated before journal path construction; only completed operations with schema 1 can be updated; append occurs under the existing exclusive lock and atomic JSON replacement. Labels are capped at 120 chars and disallow line breaks/NUL; no command string or arguments are stored. Exit code is limited to 0–255; records cap at 100. UI displays source `user-reported` and outcome labels rather than presenting them as independently verified facts. Existing output hashes and undo manifest remain unchanged. Remaining limitation: local journal JSON can still be manually edited, and cost/host measured checks are unavailable. O012 is verified at prototype scope; no independent review or real-host validation occurred.

**Next:** O013, the versioned shared event-evidence contract for Claude/Codex adapters; O004 remains blocked on real host/UI access.

## User-requested local continuous runner (2026-10-02)

**P2 — Autonomous improvements depended on the chat heartbeat runtime (mitigated at script/test level; host activation pending).** `ORCHESTRATION.md` previously described only a scheduled chat heartbeat, so this repository had no laptop-local supervisor. Added `scripts/run-autonomous.ps1` plus login-time install and graceful-uninstall scripts. The loop defaults to one run per 30 minutes with a 25-minute timeout, uses a per-repository mutex, refuses dirty worktrees, unexpected branches, or a mismatched `origin`, and halts on errors, timeouts, or the explicit queue-complete sentinel. It calls Codex CLI with `workspace-write`, approvals `never`, and outbound sandbox network explicitly disabled. The initial implementation could commit but not push; the guarded publisher added below now pushes only after its validations. The login task runs only in the interactive user's session with limited privileges. It does not wake a sleeping laptop.

Five Windows PowerShell integration tests pass using a fake Codex command and disposable repositories: script parsing, a single run honoring `CHRONICLE_RUNNER_STOP`, fail-closed behavior on a dirty checkout, failure to commit exactly one result, and acceptance of exactly one clean commit based on the starting `main`. No model was called and no scheduled task was registered. `Get-Command codex` could not resolve the CLI from the ordinary workspace shell, and access to the global npm shim was denied there. The approved global install reported a cleanup warning for a temporary npm directory (left untouched), then Codex CLI 0.160.0 and `codex login status` were verified through that installation context. Task Scheduler registration and lifecycle remain unverified; the active chat heartbeat must be paused before a second writer is enabled.

**Second-pass review:** checked the full runner and task scripts for overlapping instances, clean-worktree/index gates, exact branch/remote scope, timeout handling, error/queue stopping, and graceful uninstall. The runner uses an isolated temp state path outside the checkout and writes its stop marker without deleting recordings/logs. A dirty or uncommitted result halts subsequent work. The intended local runner must replace or be paused against the active chat heartbeat; this shared checkout has no cross-runtime mutex. Network is disabled and publication remains with the chat workflow. No independent reviewer participated.

**Remaining concern:** Although CLI version and login work through the approved installation context, task-time shim resolution, actual Windows Task Scheduler state, power/sleep/logon lifecycle, and the complete user's process tree remain unverified. The task is intentionally unregistered until the active chat heartbeat is paused or the user chooses to keep the current heartbeat instead. Full project checks and final diff review are recorded below.

**Verification:** `npm.cmd test -- --test-concurrency=1` passes all 34 tests; `npm.cmd run check` passes; `npm.cmd run demo` keeps 40 of 80 edits with zero model requests; all 18 repository Markdown files have valid relative targets; `package.json` parses; and `git diff --check` passes. The installer guard was initially exercised before CLI setup and refused registration; after installation the CLI version/auth check passed in the approved installation context. No model task or Scheduled Task was launched. The ordinary workspace shell still cannot read the npm shim, so this does not establish that the Task Scheduler's interactive session can invoke it.

**Next:** the scheduler choice and real host validation remain pending. Do not start a second writer against this checkout.

## Runner publication guard follow-up (2026-10-02)

**P1 — Continuous laptop cycles would stop after the first commit without an authorized publisher.** Review of `scripts/run-autonomous.ps1` found that the earlier runner intentionally could not push while the scheduler requires `main` to equal cached `origin/main` before each later cycle. Updated the wrapper to require both fetch and push URLs to equal the configured authorized origin, require a standalone `CHRONICLE_RUNNER_READY <hash>` result, and verify the model-created commit is exactly one clean child of the starting `main`. It runs `git show --check`, then a normal `git push origin main`; push errors preserve the local commit and stop, while success must update cached `origin/main` to the expected hash before another cycle. The Codex child remains network-disabled. No force push or fetch is used.

The Windows runner test now uses a disposable local bare Git remote and fake CLI to exercise a verified push and tracking-ref update without contacting GitHub. `npm.cmd test -- --test-concurrency=1` passes 34/34, including five runner tests; `npm.cmd run check`, the 40-of-80 demo, all 18 Markdown relative targets, `package.json` parsing, and `git diff --check` pass. Task Scheduler and a real Codex cycle remain unverified; the local task remains unregistered to avoid overlap with the active heartbeat. No independent reviewer participated.

**Second-pass concern:** the wrapper can validate commit shape and a locally successful normal push, but cannot prove semantic quality beyond the model-run checks recorded in its handoff. A host session is still needed to verify scheduler logon, shim resolution, authentication, and actual operation. **Next:** publish this guarded path, then wait for a scheduler handoff before registering the local task.

## O013 shared adapter event contract (2026-10-03)

**P2 — Claude and Codex checkpoint events had no shared versioned evidence schema.** `src/hook.js` previously built a loose object with a boundary and coarse status, without a contract version, event identity, timestamp provenance, status certainty, privacy classification, or link to the recorded snapshot/gap. Added `src/event-contract.js` to normalize only explicitly supported adapter/boundary pairs into `chronicle.adapter-event` version 1. It stores bounded safe identifiers and metadata, distinguishes Claude host-reported outcomes from Codex boundary-only observations, timestamps receipt (`recordedAt`, `timestampSource: recorder`), and records exactly one checkpoint or gap reference. Prompt/tool payloads, raw errors, and unknown fields remain unpersisted. Unknown adapters and events fail closed.

Checkpoint envelope schema stays at version 1; event versioning is independent. Gap envelope schema remains compatible, with the normalized event nested only for new captures. Storage recovery regression coverage verifies legacy checkpoint and gap bytes are unchanged. Focused tests passed for Claude failure metadata, Codex observed status, unsupported host/event rejection, capture-gap linkage, and recovery preservation. Full `npm.cmd test -- --test-concurrency=1` passes 34/34; `npm.cmd run check`, the 40-of-80 demo, all 18 Markdown relative targets, `package.json` parsing, and `git diff --check` pass.

**Second-pass concern:** this validates the normalizer and recorder behavior against fixtures, not actual host delivery or field semantics; O004 remains blocked. Recorder-generated timestamps are not host event timestamps. Retention/deletion controls are not implemented. **Next:** review the final diff, publish the fixture-level contract, then proceed to the already-proposed controlled simulated-tool fixture.

## O014 controlled simulated-tool response injector (2026-10-03; partial)

**P2 — There was no executable fixture for substituting recorded tool responses.** Added `src/simulated-replay.js` with a version-1 cassette envelope, 1 MiB/256-call bounds, a two-tool allowlist, ordered exact canonical input matching, detached cloned responses, and hash-based `injected-fixture` evidence. Unknown tools, mismatches, exhaustion, incomplete consumption, oversized cassettes, and non-JSON values fail closed. There is no live fallback, network client, workspace write, or agent invocation. Added a sample issue-tracker cassette, `npm run demo:replay`, and four tests for determinism, matching, mismatch non-consumption, allowlist/envelope validation, and limits.

All 38 tests pass serially, including four simulator tests; `npm.cmd run check`, both demos, all 18 Markdown relative targets, package JSON parsing, and `git diff --check` pass. **This is only the response-injection subcomponent** of upgrade 3. A sample coding task, fixed repository/app state, and fresh-agent orchestration in an isolated worktree remain unimplemented; the current host adapters cannot replace tool responses. O014 remains in progress. No independent reviewer participated.
