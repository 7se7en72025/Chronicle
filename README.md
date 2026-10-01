# Chronicle

**Rewind an AI agent. Change one decision. Compare what happens next.**

Chronicle is a product concept for investigating failures in AI agents. Its core idea is to make a failed run a reproducible experiment: inspect what the agent knew and did, restore a supported checkpoint, try a different instruction in an isolated branch, and verify the outcome.

This repository currently contains the product brief only. It does not include a working application, agent integration, recorder, or deployed service.

## The problem

When an agent edits the wrong file, misunderstands a constraint, or takes the wrong step in a browser, a transcript rarely explains the whole failure. Reproducing it may require reconstructing the prompt, browser state, files, database, tool results, and agent checkpoint by hand. A second run can behave differently, which makes it difficult to know whether a proposed fix actually worked.

Chronicle aims to connect those pieces in one inspectable run, with a precise explanation of which parts of the environment can and cannot be restored.

## The product

An engineer opens a failed run and selects a point on its timeline. Chronicle shows the instructions, evidence, tool call, arguments, result, files, browser capture, and checks associated with that point. The engineer changes one instruction and starts a new, isolated branch from the selected checkpoint.

The original and new branch appear side by side. Their first differing action, changed files, verified outcomes, runtime, and cost help answer three questions: Did the fix work? Did it cause another problem? Is the evidence strong enough to keep it?

When a repair is confirmed, the engineer saves the original fixture, failure condition, repaired instructions, and expected checks as a regression case. The case can then be rerun against later agent changes.

## A first demonstration

An agent builds a project dashboard and accidentally removes the existing authentication check.

1. Find the edit on the run timeline and inspect the agent's earlier view of the authentication code.
2. Restore the workspace, fixture database, and agent checkpoint just before the edit.
3. Branch with an instruction to preserve authentication and only show projects owned by the signed-in user.
4. Compare the original and repaired browser output, file changes, access-control checks, and execution cost.
5. Save the passing case as a regression test.

External actions remain simulated in the first build. The demonstration never assumes that an email, booking, or other real-world action can be undone.

## Product principles

- **Show evidence before explanations.** Distinguish recorded facts from generated hypotheses, and link each hypothesis to its supporting event.
- **Restore the environment, not just the conversation.** Record exactly which files, database state, browser storage, and agent checkpoint can be recovered.
- **Compare observable outcomes.** Use application-state assertions alongside screenshots and agent messages.
- **Change one variable at a time.** Show the run count and variability so one successful attempt is not mistaken for proof.
- **Turn verified repairs into repeatable tests.** Preserve the original failure fixture and identify unexpected changes as well as the expected outcome.
- **Make boundaries visible.** Label playback, sandbox experiments, and live retries separately. A screenshot or authentication cookie does not restore an arbitrary browser process or remote backend.
- **Protect captured information.** Redact secrets and respect access controls before recordings are shared.

## First-build scope

Start with one coding agent in a controlled workspace and a small sample application. Record tool events and screenshots at supported boundaries. Snapshot workspace files, fixture data, and agent state. Reopen a supported checkpoint in an isolated branch, compare runs, and save a verified repair as a regression case.

Simulate external actions in the sample environment. Defer multiple agents, hosted collaboration, arbitrary live websites, real external writes, and production deployment integrations until restoration and isolation are reliable.

## What the hard part is

Agent conversation replay and branching already exist in frameworks such as [LangGraph](https://www.langchain.com/blog/langgraph-v0-2). Chronicle's product hypothesis is that teams need the *whole supported working environment* restored alongside that agent state—and a clear visual comparison of the evidence and verified outcomes.

Browser screenshots or saved storage do not recreate JavaScript memory, an external website's database, a changed remote service, or an already completed side effect. Each integration needs explicit snapshot, restore, and action-reconciliation rules. Chronicle must report restoration coverage instead of promising universal undo.

## Who it is for

The initial customer hypothesis is a small team building and shipping browser-based AI agents. The primary use case is debugging and evaluating agent changes. An open-source recorder with optional paid hosted workspaces is one business model to investigate, not a validated pricing plan.

Useful early measures include time to reproduce a failure, time to verify a repair, the share of failures that become saved regression cases, and the rate at which resolved failures return after agent updates.

## Proposed implementation sequence

1. **Recorder:** connect one coding agent to a controlled application. Capture instructions, screenshots, tool events, file changes, errors, runtime, and cost.
2. **Restoration:** snapshot and restore the application fixture, database, workspace, and agent checkpoint at defined tool boundaries.
3. **Branch comparison:** run one changed instruction in an isolated environment; compare the first differing action, changes, assertions, and cost.
4. **Regression cases:** save confirmed failures and rerun them when the prompt, model, or agent code changes.
5. **Team workflows:** add shareable, access-controlled bug capsules and comments tied to a checkpoint, with sensitive data redacted.

## Open questions

- Which agent framework and task type make the first integration most useful?
- Which environment states can the first integration restore exactly and cheaply?
- Which application assertions do teams trust as evidence that a fix worked?
- Do teams value a portable local recorder, managed isolated workspaces, or both?

The goal is a small, reproducible experiment a teammate can inspect—not a promise that any agent action in any environment can be rewound.
