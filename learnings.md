# Research learnings for Chronicle

Reviewed: 2026-10-05. This is a short engineering synthesis, not a systematic literature review. It focuses on primary papers relevant to recording, debugging, replay, and evaluating tool-using coding agents. Each paper's result is separated from the product implication we infer from it.

## Runtime support and cross-platform checks (2026-10-05)

The official [Node.js releases table](https://nodejs.org/en/about/previous-releases) lists Node 20 as EOL since 2026-03-24 and Node 22 and 24 as LTS. The [EOL policy](https://nodejs.org/en/about/eol) states EOL releases no longer receive security updates. GitHub's official [`actions/setup-node`](https://github.com/actions/setup-node/releases) and [`actions/checkout`](https://github.com/actions/checkout/releases) repositories publish maintained workflow actions; Chronicle's new CI pins their reviewed immutable release commits and grants only `contents: read`.

**Chronicle decision and validation:** raise the local Node floor from 20 to 22, then test maintained LTS 22 and 24 on Linux and the current Windows runner. This is a product support choice inferred from Node's vendor lifecycle evidence. Local full-suite runs pass on Windows 11 with current Node 22.23.3 and 24.21.0 (107 pass, three Linux-only skips each), and syntax passes on both; Linux Node 22.18.0 passes 88 with 22 Windows-only skips. The official [runner-image map](https://github.com/actions/runner-images#available-images) and [Windows Server 2025 rollout notice](https://github.com/actions/runner-images/issues/14017) identify `windows-latest` as Server 2025 with VS 2026 as of this review. A diagnostic GitHub matrix tested Node 22/24 on Ubuntu, Windows Server 2022, and the current Windows image: both Ubuntu cells pass, while all four hosted Windows cells fail (`37309481907`). The two Windows image generations therefore do not explain the shared failure. The latest four-cell run on `02d5b46` again passes both Ubuntu cells and fails both `windows-latest` cells ([run 37313681845](https://github.com/7se7en72025/Chronicle/actions/runs/37313681845)). Public annotations expose only exit codes, and repository-admin access to test logs is required to identify the failing assertions before claiming Windows CI green. The temporary diagnostic image was removed from regular CI to avoid keeping redundant failing cells.

## Hosted Windows CI follow-up (2026-10-05)

The latest run on `fe9d602` ([run 37316236257](https://github.com/7se7en72025/Chronicle/actions/runs/37316236257)) passed both Ubuntu Node 22/24 cells and failed both `windows-latest` Node 22/24 cells at `npm test`. The public check annotations show only a generic exit code; anonymous job-log retrieval returns HTTP 403. This repeats the prior cross-image Windows failures, but the exact failing assertions remain unknown without repository-admin log access. Chronicle's local Windows test pass is narrower evidence and does not establish hosted runner compatibility.

A follow-up run on the documentation-only commit `f4a695d` ([run 37327539567](https://github.com/7se7en72025/Chronicle/actions/runs/37327539567)) produced the same four-cell outcome, confirming that the Windows failure persisted without another source change. Both failed Windows annotations remain generic exit-code reports; no assertion-level cause is available anonymously.

## Host usage evidence audit (2026-10-04)

Codex's published [`turn.completed` event type](https://github.com/openai/codex/blob/main/sdk/typescript/src/events.ts) exposes input, cached-input, cache-write, output, and reasoning-output token counters. Those are token usage fields, not billed-dollar values. A [recent Codex CLI report](https://github.com/openai/codex/issues/49574) documents `turn.completed.usage` on resumed threads including earlier turns' totals in CLI/SDK 0.159.2, despite the SDK type describing per-turn usage. This issue report is version-specific evidence, not proof that every Codex release or host behaves the same.

**Chronicle implication (inference):** do not sum these values or attach them to a branch as a per-run cost unless the adapter can establish a fresh-run baseline or authoritative delta and validate it on the supported host version. Keep cost and branch-comparable usage unavailable. Even an accurate token total would not establish dollar spend without a provider billing/rate contract, and product-plan quota is not a price. A bounded trace inspector can later expose raw host-reported counters with explicit scope while preserving this distinction.

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

## MCP protocol era check (2026-10-03)

The current official MCP specification revision is `2026-07-28`. It uses per-request protocol metadata and requires modern servers to support `server/discover`; the stdio transport remains newline-delimited UTF-8 JSON-RPC. The preceding `2025-11-25` revision uses an `initialize` handshake. The current spec defines explicit dual-era client probing and fallback behavior. See the primary [versioning and compatibility](https://modelcontextprotocol.io/specification/2026-07-28/basic/versioning) and [stdio transport](https://modelcontextprotocol.io/specification/2026-07-28/basic/transports/stdio) pages.

**Chronicle implication (scope decision):** the fixture MCP adapter is a deliberately narrow legacy-handshake subset. A dual-era client can identify it by probing and falling back; a modern-only client is incompatible. This does not establish which behavior current Codex or Claude releases use, and does not justify implementing the modern API without host tests. The adapter's version and limitation are now stated directly in the architecture and getting-started guide.

## Reading list

- Artzi, Kim, and Ernst (2008), [“ReCrash: Making Software Failures Reproducible by Preserving Object States”](https://homes.cs.washington.edu/~mernst/pubs/reproduce-failures-ecoop2008-abstract.html), ECOOP 2008.
- Jimenez et al. (2023), [“SWE-bench: Can Language Models Resolve Real-World GitHub Issues?”](https://arxiv.org/abs/2310.06770), arXiv:2310.06770.
- Yang et al. (2024), [“SWE-agent: Agent-Computer Interfaces Enable Automated Software Engineering”](https://arxiv.org/abs/2405.15793), arXiv:2405.15793.
- Le Sellier De Chezelles et al. (2024), [“The BrowserGym Ecosystem for Web Agent Research”](https://arxiv.org/abs/2412.05467), arXiv:2412.05467.
- Suh et al. (2026), [“AgentSuite: Toward More Reliable Agent Evaluation with a Component-Based Benchmark Auditing Pipeline”](https://proceedings.mlr.press/v306/suh26a.html), ICML 2026 / PMLR 306.

## Codex plugin manifest compatibility check (2026-10-05)

The official [plugin packaging guide](https://developers.openai.com/plugins/build/plugins#bundled-mcp-servers-and-lifecycle-hooks) documents hooks under `extensions.com.openai.hooks` in a root Agent Plugins v1 manifest and also documents `.codex-plugin/plugin.json` as a Codex compatibility manifest. On Codex CLI 0.160.0, Chronicle's root-manifest package showed zero installed hooks in `/hooks`; a second package with the same sources and only the compatibility manifest exposed five definitions. After the exact command and matcher were reviewed/trusted for the disposable fixture, two TUI exits recorded local `SessionEnd` checkpoints. No agent prompt/tool call was sent, so `SessionStart` and tool-boundary callback delivery were not tested. The matching [open Codex issue #47925](https://github.com/openai/codex/issues/47925) independently reports that Agent Plugins v1 root manifests bypass plugin hook loading.

**Chronicle implication (engineering decision):** ship `.codex-plugin/plugin.json` for current Codex compatibility. This is a host-specific workaround based on one CLI version and one Windows environment, not a general incompatibility result; keep the limitation visible and re-test later versions. The test established `SessionEnd` delivery only and did not validate Bash/Edit/Write coverage or model-mediated operation. The five test trust hashes were removed and the package disabled after the test.

- [Codex CLI issue #47925: Hooks from Agent Plugins 1.0 plugins are never loaded](https://github.com/openai/codex/issues/47925)
