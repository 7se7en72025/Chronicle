# Chronicle build plan

Status: first local slice implemented. Milestones remain incomplete until every exit condition passes, including real-host integration and recovery. Technical contracts are in [architecture.md](architecture.md).

## 0. Integration feasibility

- [x] Choose an initial path: Claude CLI hooks with VS Code review; manual checkpoints for other agents.
- [ ] Verify lifecycle events, failures, installation, trust, and review surface.
- [x] Demonstrate direct local selection and output through the CLI/demo and mocked editor integration.

Exit condition: verified capability matrix and a minimal integration validated inside its real supported host.

## 1. Local recording

- [x] Save an immutable baseline including supported pre-existing changes.
- [x] Record file versions and supported event metadata from hook payloads.
- [x] Report exclusions and uncertain attribution; hook capture failures persist bounded, sanitized gaps visible from the CLI and checkpoint-interval review.
- [x] Recover interrupted recording operations without deleting orphan data or overriding live locks.

Exit condition: saved contents are accurate and manual changes are not mislabeled as agent edits.

## 2. Selection and preview

- [x] Compare checkpoints and select complete hunks; additions/deletions use whole-file choices.
- [x] Preview complete resulting files.
- [x] Reject selections from another checkpoint pair; construct output from immutable baseline/result ranges without applying to a moving destination.

Exit condition: keep a chosen subset of README changes without model regeneration.

## 3. Branches and recovery

- [x] Apply selections in independent Git worktrees.
- [x] Preserve original contents, index, and branch.
- [x] Reconcile incomplete branch journals with Git branches/worktrees; identify interrupted or modified output for manual inspection without overwriting it.
- [x] Guard undo of selected paths in Chronicle output; refuse staged paths, later edits, or new commits and retain output workspace.

Exit condition: demonstrate branch output and recovery with dirty baselines and conflicts.

## 4. Finer selection and another host

- [ ] Add line-level change groups and linked replacements.
- [ ] Verify encoding and line-ending preservation.
- [ ] Integrate a second host through the same engine contract.

Exit condition: both hosts report actual capture coverage; direct review/select/apply makes no model requests.

## Deferred

Browser replay, database restoration, agent-session continuation, hosted collaboration, and regression execution each need separate designs and acceptance criteria.
