# Chronicle upgrade roadmap

Updated: 2026-10-02. This is a proposed, research-informed sequence, not a claim that the features exist or a promise that every item will ship. The first-release audit remains the implementation baseline; see [RELEASE_AUDIT.md](RELEASE_AUDIT.md), [PLAN.md](PLAN.md), and [learnings.md](learnings.md).

## Product target

Help a developer answer three questions with evidence: **What did the agent change? What can I safely keep? What happened when I tried that selection?** Keep review, preview, selection, and branch creation local and free of new model requests. Starting a fresh agent run from a selected branch is an explicit, host-mediated action and may use credits.

Use these terms consistently:

- **Inspect:** browse immutable checkpoint files, event boundaries, capture gaps, and diffs. This is implemented for supported files.
- **Select and branch:** reconstruct chosen whole files, hunks, or change groups in an output worktree. This is implemented, with fixture verification and documented limits.
- **Fresh retry:** start a new host run against a chosen workspace and revised instruction. This needs an agent host integration and uses the host's model/tool budget.
- **Simulated replay:** rerun a controlled fixture while substituting recorded tool responses. This is future work and cannot reproduce unrecorded state or arbitrary external side effects.
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

**Still needed:** verify event delivery and fields in real hosts under O004; define user-facing retention/deletion controls and migration policy before moving beyond local JSON records or to SQLite.

**Exit:** Claude and Codex fixtures map to one versioned contract; unknown fields are ignored and unsupported source/boundary pairs fail closed without workspace mutation; sensitive raw payloads are absent; recovery fixtures preserve prior checkpoint and gap records.

### 3. Add controlled simulated-tool replay

**Why:** record/replay research supports reproducing a failure when the relevant state and inputs are preserved. It does not support replaying arbitrary APIs safely.

**Build:** a sample coding task with a local app and a small allowlisted tool simulator. Freeze the initial repository, tool responses, and app state. Let the user fork at an observed boundary, change the instruction, and start a **new** agent run in an isolated worktree. Label events as injected fixture responses, live calls, or unmatched/missing. Keep live network and destructive tools disabled by default.

**Exit:** repeated fixture runs start from the same verified state; a recorded response can be substituted without contacting its original service; unmatched inputs stop or are clearly shown; the original workspace and fixture data remain unchanged.

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
