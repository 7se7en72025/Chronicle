# Autonomous development orchestration

## Purpose

Continuously review and improve the local Chronicle prototype from this chat without requiring a new prompt for every task. The user authorized autonomous development orchestration on 2026-10-02 and specified the cycle: review, update, review again.

This uses a Codex thread heartbeat, not a background AI service implemented in Chronicle. Intended cadence: every 30 minutes. Scheduler configuration is authoritative; this file describes the development workflow.

Configured heartbeat: `chronicle-review-and-improve`, ACTIVE as of 2026-10-02. It is scheduled every 30 minutes. Each activation targets up to about 25 minutes of focused work, continuing across independent review, implementation, verification, documentation, commit, and push steps instead of stopping after one small change. The exact runtime is controlled by Codex and is not guaranteed to fill the entire window. The first scheduled execution remains unverified.

The desktop runtime must be available to execute local work. Do not assume closed-app, sleeping-computer, offline, or exhausted-account execution. Agent runs consume model usage; the finished local recorder and Git helper have a separate no-model path.

## Work loop

1. Read AGENTS.md, HANDOFF.md, PLAN.md, REVIEW.md, and this queue. Incorporate newer human instructions.
2. Inspect Git status and current work before making changes. Preserve existing uncommitted prototype and documentation work.
3. Review current code and recent changes for concrete bugs, regressions, missing checks, and stale claims. Record actionable findings with file/function evidence in REVIEW.md. Prioritize preservation of user work and correctness over cosmetic edits.
4. Choose the highest-impact actionable finding, or one pending queue task if the focused review finds no issue. Mark it in progress, implement a focused change, and run meaningful verification. If blocked, record specific evidence and choose another viable independent task.
5. Review the final diff in a second pass, including edge cases and regression risks. Update REVIEW.md with findings, fix evidence, checks, unresolved concerns, and next step. Mark the task verified only if acceptance criteria pass; otherwise preserve an accurate pending or blocked state.
6. Update HANDOFF.md and relevant plan, architecture, decisions, changelog, and run instructions.
7. Continue with the next viable queue task until roughly 25 minutes of this activation have elapsed, unless all scope is complete or a concrete stopping condition applies. Before ending, update HANDOFF.md with the next task. If meaningful verified changes exist, inspect the final diff, stage only task-related files, commit with a clear message, and push normally. Do not create empty or unchanged-status-only commits. Report commit and push outcome accurately.

Do not launch an unbounded nested loop, another recurring automation, or duplicate worker chats. Do not run parallel writers in this checkout. If another run is modifying the same task, defer rather than interleave writes. Queue status is cooperative coordination, not an enforced process lock.

Reviewer, implementer, and verifier are sequential stages in this thread. Do not claim an independent second agent approved a change unless that review actually occurred.

## Queue

| ID | State | Task | Acceptance criteria |
| --- | --- | --- | --- |
| O001 | Pending | Persist and expose capture gaps | Skipped/busy/failed recording boundaries remain inspectable without storing raw secret-bearing payloads; CLI and review UI show coverage honestly; integration tests pass |
| O002 | Pending | Recover interrupted recording storage | Interrupted JSON/blob writes and stale locks have a safe, explicit recovery path; a live recorder is never unlocked or killed; interruption tests pass |
| O003 | Pending | Recover branch operations | Reconcile prepared/applying/failed journal states with actual branches and worktrees; preserve modified output workspaces; verify interruption and conflict cases |
| O004 | Pending | Validate a real editor and Claude integration | Record actual host versions, command activation, capture events, trust/install behavior, and a full review-to-output flow; report unavailable prerequisites instead of inventing a pass |
| O005 | Pending | Guarded undo for Chronicle output | Restore only Chronicle-owned operation effects after checking destination contents; refuse to overwrite later edits; meaningful tests and UI/CLI guidance |
| O006 | Pending | Finer change-group selection | Link replacements and validate resulting file bytes; demonstrate selecting useful parts within a hunk, preserving encoding and line endings |
| O007 | Pending | Evaluate and add a Codex capture adapter | Verify current official event support; implement supported boundaries and expose gaps; do not claim native custom UI or hidden-state access without evidence |
| O008 | Pending | First-release audit | Run current checks and demo, reconcile all docs, list actual supported hosts and remaining limitations, and present the local result for review |

Task priority may change to address a concrete bug or unmet prerequisite within PLAN.md. Record the reason. Do not expand to hosted collaboration, browser/database replay, billing, or production deployment without user direction.

## Boundaries and stopping

Autonomous implementation, focused tests, living-document updates, commits, and normal pushes are authorized. Current destination: `origin` at `https://github.com/7se7en72025/Chronicle.git`, branch `main`. Recheck the branch and remote before each push; do not silently redirect publication.

Do not commit failing work, unrelated changes, secrets, private snapshots, or generated artifacts. Preserve pre-existing staging. Never force-push or rewrite history. If the remote rejects a push, report the reason and retain the verified local commit; do not blindly overwrite remote work.

Marketplace publication, purchases, account changes, external messages, destructive cleanup, and deployment remain outside this workflow.

When every queued task is verified, report completion and require user direction for new scope. If no task can progress, record concrete blockers and avoid repetitive edits. Respect a human stop or pause request immediately.

The intended loop is a scheduled activation every 30 minutes with up to about 25 minutes of focused work per activation. It is not a continuously running process. Codex controls actual run duration and availability; the local desktop must be available. An always-on server would require separate deployment.
