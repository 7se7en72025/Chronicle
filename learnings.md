# Research learnings for Chronicle

Reviewed: 2026-10-02. This is a short engineering synthesis, not a systematic literature review. It focuses on primary papers relevant to recording, debugging, replay, and evaluating tool-using coding agents. Each paper's result is separated from the product implication we infer from it.

## What the research says

### Reproduce the failure with the state that caused it

Artzi, Kim, and Ernst's [ReCrash paper](https://homes.cs.washington.edu/~mernst/pubs/reproduce-failures-ecoop2008-abstract.html) stores partial method arguments during execution and uses them to generate tests after a crash. It demonstrates a general debugging principle: a failure report becomes more useful when it preserves enough relevant inputs/state to reproduce the failure. Its Java method-state technique is not a recipe for restoring an LLM agent, browser, or whole developer machine.

**Chronicle implication:** keep immutable workspace snapshots and boundary metadata, then make a reproduced case concrete by storing a task fixture, known initial commit, selected file state, observed tool boundary, and optional check result. The first useful unit is “reopen this recorded workspace state,” not “restore the model's hidden thoughts.”

### The interface and environment are part of the agent system

Yang et al.'s [SWE-agent paper](https://arxiv.org/abs/2405.15793) studies how a purpose-built agent-computer interface affects repository navigation, editing, and test execution. The paper's result supports treating the host interface as an experimental factor, not an invisible detail.

Jimenez et al.'s [SWE-bench paper](https://arxiv.org/abs/2310.06770) builds tasks from real issues and pull requests. It notes that many tasks require coordinated changes across functions and files, with interaction and execution environments. A line or hunk subset can therefore be textually valid and still fail the task.

**Chronicle implication:** record the host and adapter versions, supported events, repository commit, selection, and checks alongside branch output. Label edits as observed around a host event; do not claim exclusive authorship. Treat selected output as a candidate that still needs project checks and human review.

### Standardize the controlled environment before comparing runs

Le Sellier De Chezelles et al.'s [BrowserGym paper](https://arxiv.org/abs/2412.05467) responds to fragmented web-agent evaluation by providing shared task/action interfaces and repeatable experiment tooling across benchmark environments. The authors also emphasize that real web environments remain difficult for agents.

**Chronicle implication:** compare like with like. A future browser experiment needs a named, resettable fixture and an explicit list of captured browser state. A screenshot or URL alone is evidence for a reviewer, not a browser checkpoint. Start with a local sample app and deterministic simulated tools; avoid replaying real purchases, messages, or production API writes.

### Audit the task, environment, tools, and evaluation separately

Suh et al.'s ICML 2026 [AgentSuite paper](https://proceedings.mlr.press/v306/suh26a.html) organizes benchmark auditing around four interacting components: user instructions, environment, ground truth, and evaluation. It reports that flaws across these components can confound measured agent performance.

**Chronicle implication:** a branch comparison should expose its inputs: original instruction when the host makes it available and retention is acceptable, workspace baseline, agent/adapter and tool context that can be safely recorded, and the exact local checks used to compare outcomes. If a field is unavailable, mark it unavailable. Do not claim a repaired run is better from a changed diff alone.

## Product principles derived from the papers

These are design recommendations inferred from the cited work, not experimental findings claimed by those authors.

1. **Make recording coverage visible.** Show observed boundaries, exclusions, missing events, and uncertain authorship next to the timeline. A silent gap is ambiguous evidence.
2. **Describe replay levels precisely.** Chronicle currently supports checkpoint inspection and selected file-state reconstruction. A new agent run from a selected workspace is a fresh run and may spend model credits. Simulated-tool replay can reuse recorded responses; live tools and external side effects need separate opt-in handling. Full OS/process/browser restoration is a different, later capability.
3. **Compare reproducible inputs.** Pin the repository commit, snapshot IDs, tool simulation fixture, and checks. Show environment drift and missing inputs instead of silently comparing unlike branches.
4. **Keep outcomes inspectable.** Report patch/file diffs, check names and exit results, and host-reported costs only when exposed. Do not compress these into an unsupported single quality score.
5. **Minimize sensitive traces.** Tool inputs, model reasoning, browser data, and file contents can contain secrets. Capture only necessary fields, keep recordings local by default, and provide retention/export/deletion policy before adding any sharing or hosted workflow.

## What the papers do not establish

The cited research does not prove that Chronicle can restore arbitrary agent state, replay vendor tools exactly, undo external actions, or infer whether code is semantically correct. ReCrash reproduces program failures from captured method inputs; SWE-agent and SWE-bench study coding-agent interfaces/tasks; BrowserGym studies controlled web-agent environments; AgentSuite studies benchmark validity. Chronicle must test its own host adapters and restoration contract directly.

## Host integration documentation check (2026-10-03)

Current [Claude Code hook documentation](https://code.claude.com/docs/en/hooks#posttooluse-decision-control) says `PostToolUse.updatedToolOutput` changes what the model sees after the tool has already run. [Codex hook documentation](https://developers.openai.com/codex/hooks) describes rewriting tool inputs before execution and replacing the model-visible result with hook feedback after execution. These are vendor API facts, not paper findings.

**Chronicle implication (design inference):** a post-tool rewrite can reproduce an observed response in model context, but cannot make the original call side-effect-free. Safe cassette replay must give the agent a controlled fixture tool or use an orchestrator that owns tool dispatch and can return the saved response before a live operation occurs. Host hook fixtures alone do not validate that integration.

## Reading list

- Artzi, Kim, and Ernst (2008), [“ReCrash: Making Software Failures Reproducible by Preserving Object States”](https://homes.cs.washington.edu/~mernst/pubs/reproduce-failures-ecoop2008-abstract.html), ECOOP 2008.
- Jimenez et al. (2023), [“SWE-bench: Can Language Models Resolve Real-World GitHub Issues?”](https://arxiv.org/abs/2310.06770), arXiv:2310.06770.
- Yang et al. (2024), [“SWE-agent: Agent-Computer Interfaces Enable Automated Software Engineering”](https://arxiv.org/abs/2405.15793), arXiv:2405.15793.
- Le Sellier De Chezelles et al. (2024), [“The BrowserGym Ecosystem for Web Agent Research”](https://arxiv.org/abs/2412.05467), arXiv:2412.05467.
- Suh et al. (2026), [“AgentSuite: Toward More Reliable Agent Evaluation with a Component-Based Benchmark Auditing Pipeline”](https://proceedings.mlr.press/v306/suh26a.html), ICML 2026 / PMLR 306.
