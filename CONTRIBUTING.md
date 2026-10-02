# Contributing to Chronicle

Chronicle has an early local prototype and implementation is authorized. Start with [README.md](README.md), [HANDOFF.md](HANDOFF.md), and [AGENTS.md](AGENTS.md). Run instructions are in [GETTING_STARTED.md](GETTING_STARTED.md).

## The living-repo workflow

1. Read the current handoff and inspect existing changes.
2. Define one concrete outcome and how to verify it. For substantial work, use an issue to record scope and acceptance criteria.
3. Make a focused change. Preserve unrelated work.
4. Run appropriate checks and record actual results, including failures or checks not run.
5. Update the affected living documents in the same change.
6. Review the final diff before committing or submitting a pull request.

Contributors and agents update documents as they work. Autonomous work may use the 30-minute Codex chat heartbeat or the optional [Windows laptop runner](ORCHESTRATION.md#optional-windows-laptop-runner); never run both against this checkout. Follow [ORCHESTRATION.md](ORCHESTRATION.md) and maintain [REVIEW.md](REVIEW.md). Each model-driven cycle consumes usage and needs an available runtime. In laptop mode, the Codex child has network disabled; the supervising script may push one strictly validated commit to the exact authorized origin. The local runner is a development helper, not part of Chronicle's end-user recorder.

## Which document owns what?

| Question | Source of truth |
| --- | --- |
| What does Chronicle promise? | [README.md](README.md) |
| How should components work? | [architecture.md](architecture.md) |
| What remains to be built? | [PLAN.md](PLAN.md) |
| Why did we choose this approach? | [DECISIONS.md](DECISIONS.md) |
| Where should the next contributor start? | [HANDOFF.md](HANDOFF.md) |
| What changed? | [CHANGELOG.md](CHANGELOG.md) |
| How should agents work here? | [AGENTS.md](AGENTS.md) |

## Documentation updates

Keep the handoff short: current state, latest meaningful work, verification, unresolved questions, and the next concrete task. Replace stale status instead of appending contradictory updates.

Mark plan items complete only when acceptance criteria pass. Documentation describing a component does not mean that component exists.

For a durable design decision, add an ID, status, choice, rationale, and condition for revisiting it. Mark replaced choices superseded. Keep temporary progress in the handoff rather than the decision log.

Use the changelog for meaningful project changes, not a transcript of every action. Link to detailed documents instead of repeating their content.

## Review checklist

- Scope matches the request and current milestone.
- Claims distinguish proposed, implemented, and verified behavior.
- Relative documentation links resolve and formatting is readable.
- Verification results are stated accurately.
- Relevant documents agree with each other.
- No secrets, private recordings, or generated artifacts are included.
- The handoff gives the next contributor an actionable starting point.

Issue and pull-request templates live in `.github`. They become available on GitHub after these files are pushed to the default branch.
