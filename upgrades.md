# Chronicle upgrade roadmap

Updated: 2026-10-03. This is a proposed, research-informed sequence, not a claim that the features exist or a promise that every item will ship. The first-release audit remains the implementation baseline; see [RELEASE_AUDIT.md](RELEASE_AUDIT.md), [PLAN.md](PLAN.md), and [learnings.md](learnings.md).

## Product target

Help a developer answer three questions with evidence: **What did the agent change? What can I safely keep? What happened when I tried that selection?** Keep review, preview, selection, and branch creation local and free of new model requests. Starting a fresh agent run from a selected branch is an explicit, host-mediated action and may use credits.

Use these terms consistently:

- **Inspect:** browse immutable checkpoint files, event boundaries, capture gaps, and diffs. This is implemented for supported files.
- **Select and branch:** reconstruct chosen whole files, hunks, or change groups in an output worktree. This is implemented, with fixture verification and documented limits.
- **Fresh retry:** start a new host run against a chosen workspace and revised instruction. This needs an agent host integration and uses the host's model/tool budget.
- **Simulated replay:** a bounded fixture response injector and legacy MCP stdio subset are implemented and fixture-tested. Starting a fresh real agent run through a controlled orchestrator and substituting cassette responses before tool effects remains future work; neither can reproduce unrecorded state or arbitrary external side effects.
- **Environment restore:** restore browser memory, databases, processes, or an OS image. This is outside the first release and requires a dedicated capture/isolation contract.

## Recommended order

### 0. Prove one real host path

**Why first:** Chronicle's strongest integration claims are currently fixture-tested. [SWE-agent](https://arxiv.org/abs/2405.15793) treats the agent-computer interface as part of the system, and [AgentSuite](https://proceedings.mlr.press/v306/suh26a.html) shows that environment/tool/evaluation assumptions can confound results.

**Build and verify:** use a disposable repository with staged and unstaged human edits; install and trust one local adapter; record a successful tool and a tool that partially writes then fails; inspect gaps and attribution; make a selection in the real review surface; verify output and untouched original/index; run guarded undo and refusal cases. Save host/version and observed event coverage, with no private transcript or recording in Git.

**Exit:** documented matrix of events actually observed in that host, successful review and branch flow, and demonstrated preservation of source/index. Until this passes, label host support experimental.

### 1. Make evidence comparable — partially implemented

**Why:** [SWE-bench](https://arxiv.org/abs/2310.06770) uses real tasks whose solutions can span files and require executable checks. [AgentSuite](https://proceedings.mlr.press/v306/suh26a.html) cautions that task, environment, and evaluation defects distort outcomes.

**Implemented:** each completed output operation now saves a versioned manifest with source checkpoints, baseline commit, selected change IDs, observed host attribution, captured gap/exclusion counts, measured Node/platform facts, and output file hashes/modes. The CLI and VS Code review surface compare two completed operations' saved outputs without rerunning the agent. Developers can manually record their own check labels and exit codes; Chronicle marks these reports as user-reported and never runs commands. See [architecture.md](architecture.md), `compare-operations`, `record-check`, and **Chronicle: Compare Saved Branches** in [GETTING_STARTED.md](GETTING_STARTED.md).

**Still needed:** collect optional host-reported cost and validate the workflow in a real editor/agent host. Missing values must remain “unavailable.”

**Exit:** fixed fixture, two selections, same named checks, byte-verifiable outputs, and a visual comparison that clearly distinguishes recorded facts from missing data. The CLI and VS Code compare two saved selections; user-run check reports are identified as unverified reports and missing cost remains unavailable. Validate the flow in a real editor/agent host before calling the phase complete. Do not add an automatic semantic pass/fail score.

### 2. Define a durable event and evidence contract — implemented at fixture level

**Why:** [ReCrash](https://homes.cs.washington.edu/~mernst/pubs/reproduce-failures-ecoop2008-abstract.html) motivates preserving relevant failure inputs for reproduction, while [BrowserGym](https://arxiv.org/abs/2412.05467) shows the value of standard task/action interfaces across controlled environments.

**Implemented:** Claude and Codex fixtures now map to versioned `chronicle.adapter-event` schema 1 with host, bounded session/event identifiers, boundary, status certainty, Chronicle-recorded timestamp, snapshot/gap reference, and metadata-only privacy classification. “Observed,” “reported success,” and “reported failure” remain distinct. Unknown source/boundary pairs fail closed; recovery tests preserve existing schema-1 checkpoint and gap bytes. See [architecture.md](architecture.md) and O013 in [ORCHESTRATION.md](ORCHESTRATION.md).

**Still needed:** real Codex CLI 0.160.0 delivered session and read-only fixture MCP pre/post-tool checkpoints through temporary inline hooks, but the shipped plugin path and Bash/file-edit boundaries still need host validation under O004. Claude delivery also remains untested. Define user-facing retention/deletion controls and migration policy before moving beyond local JSON records or to SQLite.

**Exit:** Claude and Codex fixtures map to one versioned contract; unknown fields are ignored and unsupported source/boundary pairs fail closed without workspace mutation; sensitive raw payloads are absent; recovery fixtures preserve prior checkpoint and gap records.

### 3. Add controlled simulated-tool replay — response injector partially implemented

**Why:** record/replay research supports reproducing a failure when the relevant state and inputs are preserved. It does not support replaying arbitrary APIs safely.

**Implemented subcomponent:** `src/simulated-replay.js` consumes a bounded schema-1 JSON cassette with an explicit allowlist and exact ordered tool/input matching. It injects cloned fixture responses with hashes, refuses unknown tools, mismatches, exhaustion, and incomplete sequences, and has no live fallback or network path. `npm run demo:replay` repeats the same responses in two disposable Git worktrees rooted at the same commit; each resets a headless sample issue-tracker state fixture and reports an identical SHA-256 fingerprint before the deterministic README task receives alternate instructions. A regression deliberately drifts the app state and verifies reset to the exact fixture bytes. This is not a running web app, AI-agent run, host tool interception, or browser/environment restore.

`src/simulated-replay-mcp.js` and `scripts/simulated-replay-mcp.js` now expose the allowlisted cassette calls through a dependency-free MCP stdio subset (`initialize`, `ping`, `tools/list`, and `tools/call`). It returns only cassette output, records hash evidence on stderr, and fails closed on unknown tools, mismatches, oversized messages, and incomplete consumption. A child-process protocol test verifies newline JSON-RPC framing without a model request. Host MCP registration and client compatibility remain unverified; this is not a full MCP SDK implementation.

**Compatibility boundary checked (2026-10-03):** the current official MCP revision is `2026-07-28`, which uses per-request metadata and `server/discover`. Chronicle intentionally remains pinned to the legacy `2025-11-25` initialize handshake. The stdio binding says dual-era clients should probe `server/discover` and fall back to initialize after a non-modern error; a modern-only client cannot use this server. This documentation/test change does not implement the modern protocol or establish compatibility with Codex or Claude. See the primary [versioning and compatibility spec](https://modelcontextprotocol.io/specification/2026-07-28/basic/versioning) and [stdio binding](https://modelcontextprotocol.io/specification/2026-07-28/basic/transports/stdio).

**Host boundary checked (2026-10-03):** Claude Code hooks expose `PreToolUse.updatedInput` and `PostToolUse.updatedToolOutput`; the latter replaces the model-visible output only after the tool has run. Codex hooks expose `PreToolUse.updatedInput` and can replace the model-visible result with feedback from a blocking `PostToolUse`, also after execution. Therefore these post-tool hooks are not a safe way to avoid the original tool's side effects. See the official [Claude Code hooks reference](https://code.claude.com/docs/en/hooks#posttooluse-decision-control) and [Codex hooks reference](https://developers.openai.com/codex/hooks).

**Observed host path:** with temporary command-line MCP configuration, Codex CLI 0.160.0 called the two allowlisted fixture tools in cassette order and received the saved responses. Later read-only host turns observed an unmatched first lookup and an exhausted third call after two matching responses. Codex reported failed MCP items yet exited zero, so turn/process completion cannot prove cassette completion. A bounded read-only JSONL auditor reports whether visible host items match the ordered cassette and flags failed traces. The fixture server can fsync a completion marker after its own successful EOF, but a plain Codex two-call turn wrote both server events and exited without that marker. An explicit `fixture.replay.finish` tool now writes the marker before returning a run-ID/hash receipt. A later real read-only Codex turn called lookup, search, then finish; its host-visible receipt, sidecar, and marker were content-consistent, and the disposable tracked README stayed unchanged. This is narrow host/server evidence, not a signed host attestation or exhaustive tool coverage. No persistent MCP entry was created and no `/mcp` UI inspection occurred. Claude Code remains untested. See [REVIEW.md](REVIEW.md) for exact coverage. A later read-only turn attempted a shell command that host policy blocked; native stderr reported the rejection while JSONL omitted a command item. The auditor now flags unexpected stderr diagnostics and requires that file for server-evidence consistency. Next establish an explicit host-tool coverage contract before guarded agent-run binding; do not bypass host policy. Keep live network and destructive tools disabled by default. An agent-mediated invocation or fresh task spends model usage; inspection of an existing trace does not.

**Local durability step:** the controlled child now fsyncs a bounded metadata-only evidence sidecar before forwarding each event to the controller. `inspect-fixture-evidence` reports whether the sidecar and journal are consistent, the sidecar is ahead, or evidence is invalid/unavailable. Recovery refuses to change a pending journal when the sidecar is invalid or conflicting; consistent or sidecar-ahead records can only become failed after existing process-death checks. This does not establish tool provenance or prove host tool activity. Reconciliation of additional sidecar events remains unimplemented.

Per [D014](DECISIONS.md#d014--keep-interrupted-fixture-sidecars-separate-from-journals), sidecar-ahead events remain separate during recovery. A merge would need a versioned append-only log, durable completion marker, and real interruption evidence; it is not an automatic next step for the current fixture.

New controlled subprocess runs require a consistent child-written sidecar before fixture evidence can be bound or displayed in branch comparison. Legacy records without a sidecar marker retain their earlier journal/cassette checks. This is local consistency evidence, not independent host-tool observation.

Local fixture-run journal, cassette, sidecar, and launch-witness reads are bounded through an opened regular-file descriptor and checked against pre/open/post file identity and size. An observed but unreadable witness still leaves recovery pending. This narrows replacement and growth races; it is not a guarantee against every concurrent same-size write or a substitute for host provenance.

**Exit:** repeated fixture runs start from the same verified state; a recorded response can be substituted without contacting its original service; unmatched inputs stop or are clearly shown; the original workspace and fixture data remain unchanged; and an actual host/orchestrator run is validated separately before claiming fresh agent retries.

### 4. Consider browser and richer environment snapshots

**Why later:** [BrowserGym](https://arxiv.org/abs/2412.05467) demonstrates purpose-built, standardized web environments; a URL and screenshot do not restore browser storage, authentication, server data, or time-dependent state.

**Build only for a controlled local fixture:** versioned browser profile or fixture reset, local app/database seed, network allowlist, environment fingerprint, lifecycle capture, and teardown/recovery. Store screenshots as evidence alongside structured state, not as a substitute for it.

**Exit:** prove reset and repeatability on a local sample app, enumerate every uncaptured state channel, and test interruption without touching production accounts or external services.

## Cross-cutting release gates

- Preserve the source working tree, branch, and Git index; fail closed on stale selections and mismatched operation state.
- Test crashes at each write/journal boundary and keep recoverable user data.
- Make capture gaps, exclusions, and uncertain authorship visible in the same view as the affected changes.
- Keep direct deterministic operations out of the model path; label fresh retries as model/tool actions.
- Keep the source files complete and selected result preview visible before mutation.
- Document local storage, secret-file exclusions, retention/deletion, and export boundaries before collaboration or hosting.
- Run project tests for outcomes, while explaining that passing checks establish only the checks that were run.

## Explicitly deferred

Native Codex panel embedding, cross-team hosted collaboration, remote rollback, arbitrary production-browser replay, database rollback, exact internal agent-state restoration, and marketplace publication. Revisit each only with a tested integration contract and clear user authorization.
