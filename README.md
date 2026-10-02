# Chronicle

**Keep the useful parts of an AI agent's changes without generating them again.**

Chronicle is an early local-first companion for coding agents such as Codex and Claude Code. It records supported workspace changes, shows checkpoints and diffs, and lets you select edits to apply in a separate branch.

The first prototype includes a local engine, CLI, VS Code review extension, and an optional Claude Code hook adapter. It is not published or production-ready. The CLI and engine are tested; editor interactions are tested through a mocked host, and a real Claude session remains unverified.

## Try it

Requirements: Node.js 20+ and Git. No npm dependencies need installing.

```sh
npm test
npm run demo
```

The demo keeps 40 of 80 changed lines in a separate fixture worktree. See [Getting started](GETTING_STARTED.md) to run the editor panel, CLI, and optional hooks.

## The first use case

An agent changes 80 lines in a README. You want only some of those changes.

1. Open Chronicle's review panel in your coding environment.
2. Compare the starting checkpoint with the agent's result.
3. Select the files or change groups you want.
4. Preview the complete resulting document.
5. Create a branch containing your selection.

Direct recording, review, selection, and Git application make no model requests. Asking the agent to explain, repair, or continue work can consume model credits. Arbitrary selections may conflict or depend on other edits, so Chronicle must validate the patch and show a preview.

## Product boundaries

- Start with one supported agent/editor combination and regular text files.
- Keep the user in their coding workflow; no separate hosted website is required.
- Preserve pre-existing edits and the original Git index.
- Show capture gaps and uncertain change attribution.
- Apply into a separate worktree by default; this does not discard edits from the original workspace.
- Verify host UI and hook capabilities before promising integration.

The broader vision includes controlled environment replay and branch comparison. Browser, database, and internal agent-state restoration are later scope. File snapshots cannot undo arbitrary remote actions.

## Documentation map

| Document | Purpose |
| --- | --- |
| [Architecture](architecture.md) | Components, stack, data flow, limits, and recovery |
| [Build plan](PLAN.md) | Milestones and acceptance criteria |
| [Design decisions](DECISIONS.md) | Choices, reasons, and when to revisit them |
| [Current handoff](HANDOFF.md) | Current state and next concrete task |
| [Changelog](CHANGELOG.md) | Meaningful changes |
| [Agent instructions](AGENTS.md) | Shared working rules and documentation maintenance |
| [Claude entry point](CLAUDE.md) | Points Claude Code to the shared instructions |
| [Contribution workflow](CONTRIBUTING.md) | Task, review, verification, and documentation maintenance |
| [Getting started](GETTING_STARTED.md) | Run the prototype and understand its current limits |
| [Development orchestration](ORCHESTRATION.md) | Autonomous task queue, verification, and operating boundaries |
| [Latest review](REVIEW.md) | Concrete findings, fixes, checks, and remaining concerns |

## Keeping this repo current

Update the handoff when work changes the project state. Record durable choices in the decision log, and mark plan items complete only after acceptance criteria pass. Keep proposed behavior separate from implemented and verified behavior.

Follow [the contribution workflow](CONTRIBUTING.md) for each task. Issue and PR templates in `.github` prompt contributors to record acceptance criteria, checks, and documentation updates. An ACTIVE Codex heartbeat is scheduled every 30 minutes and targets up to about 25 minutes of focused review, fixes, checks, docs, commit, and push per activation when runtime is available. Actual duration is not guaranteed. See [the orchestration workflow](ORCHESTRATION.md). Scheduled development consumes model usage; Chronicle's direct recorder/review/Git path remains separate.

The business model remains a hypothesis: an open-source local core, with optional paid collaboration or hosted workspaces later. The first goal is a useful, reliable local selection workflow.
