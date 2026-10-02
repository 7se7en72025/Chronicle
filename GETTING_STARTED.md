# Run the first Chronicle prototype

This is a local development prototype, not a published extension. It has no npm runtime dependencies and makes no model or network requests. Requirements: Node.js 20 or later, Git, and optionally VS Code.

## Fast demonstration

From this repository:

```sh
npm test
npm run check
npm run demo
```

The demo creates a temporary Git fixture, changes 80 lines, selects the hunk containing the wanted 40 changes, and creates a separate output worktree. It prints both locations and retains them for inspection. It never edits your project to perform the demonstration.

## Review beside your agent in VS Code

1. Open the Chronicle repository in VS Code.
2. Choose **Run Chronicle Extension** in Run and Debug, then start it with F5.
3. In the new Extension Development Host window, open a small trusted Git project with at least one commit.
4. Save files and run **Chronicle: Capture Checkpoint** from the Command Palette. Label it “Before agent”.
5. Make changes using your coding agent or manually. Save files and capture “After agent”.
6. Run **Chronicle: Review Changes** and select the before and after checkpoints.
7. Choose hunks, click **Preview selection**, then **Create branch from preview**.
8. Open the output workspace when prompted. Review and commit its changes through your normal Git workflow.

The original workspace keeps all its current edits. Branch output is baseline plus selected changes; it may also contain pre-existing baseline edits, and it remains uncommitted. Select a full hunk or some change groups within a hunk. Replacement lines stay linked, and the preview shows the complete resulting file.

The helper uses saved file bytes. Unsaved editor buffers are not captured. Do not use the prototype on valuable or sensitive work until you have reviewed its capture policy and limitations.

## Command-line flow

Run these commands inside the project being recorded. Replace the script path with your Chronicle checkout location:

```sh
node /path/to/Chronicle/src/cli.js capture "Before agent"
# Make changes and save files.
node /path/to/Chronicle/src/cli.js capture "After agent"
node /path/to/Chronicle/src/cli.js list
node /path/to/Chronicle/src/cli.js diff BEFORE_ID AFTER_ID
node /path/to/Chronicle/src/cli.js gaps
node /path/to/Chronicle/src/cli.js recover
node /path/to/Chronicle/src/cli.js preview BEFORE_ID AFTER_ID HUNK_ID
node /path/to/Chronicle/src/cli.js branch BEFORE_ID AFTER_ID chronicle/my-selection HUNK_ID
node /path/to/Chronicle/src/cli.js operations
node /path/to/Chronicle/src/cli.js compare-operations FIRST_OPERATION_ID SECOND_OPERATION_ID
node /path/to/Chronicle/src/cli.js undo OPERATION_ID
node /path/to/Chronicle/src/cli.js reconcile
```

Quote paths containing spaces. The diff command returns hunk IDs and, for multi-edit hunks, change-group IDs. Supply one or more to preview and branch. A change group keeps contiguous replacement lines together; unchanged context separates groups. IDs are tied to the checkpoint pair, so selections from another pair are rejected.

Undo restores only selected paths in Chronicle's separate output worktree to their saved baseline. It checks their current bytes and file modes first, and refuses if the branch gained commits or those paths have staged or later changes. The original recording workspace is untouched; the output branch and worktree remain available. In VS Code, use **Chronicle: Undo Output Operation** and confirm the selected operation. If an undo is interrupted, rerunning it can resume only while each selected path still matches either Chronicle's output or the saved baseline.

Each completed output operation saves a versioned manifest of its source checkpoints, selected change IDs, measured environment, observed host labels, capture gaps, and output file hashes/modes. `compare-operations` prints a local, read-only comparison of two operation manifests, including added, deleted, changed, and identical paths. It does not run tests or an agent. An empty `checks` list means no checks were recorded; `reportedCost: null` means unavailable, not free. Visual comparison and explicit check-result recording are not implemented yet.

In VS Code, run **Chronicle: Compare Saved Branches** from the Command Palette and choose exactly two completed output branches. The local comparison view shows each branch's recorded environment and coverage beside a file-by-file hash/mode comparison. It does not run tests or an agent; absent check results and costs are labeled unavailable.

## Optional Claude Code recording

The repository includes a local Claude plugin manifest and [hook configuration](hooks/hooks.json). It records `SessionStart` and before/success/failure boundaries for `Edit`, `Write`, `Bash`, and `PowerShell`. Other tools, denied operations, concurrent edits, and background changes may not be captured accurately.

With a compatible Claude Code CLI installed, start it in the project you want to record:

```sh
claude --plugin-dir /path/to/Chronicle
```

Restart the session after changing plugin files. Node must be available in the hook environment. Review and enable the plugin through the host's normal trust flow. See the official [plugin documentation](https://code.claude.com/docs/en/plugins) and [hook reference](https://code.claude.com/docs/en/hooks).

Hook payload handling is tested locally, including a failed tool that leaves a partial edit. A real Claude Code session has not been tested on this machine. The hook records limited event identifiers and status, not prompts, tool input/output, or transcript contents. File snapshots can still contain secrets: filename exclusions are not content redaction.

Hook failures write a bounded, local capture-gap record and report the issue on stderr without blocking the agent. Gap records store event identifiers and a fixed reason category; raw prompts, commands, and tool errors are not saved. `gaps` lists them, and the review panel shows gaps in the selected checkpoint interval. Each repository retains at most 1,000 gap entries, after which it records a limit marker. A busy recorder skips capture rather than inventing an exact timeline. Review in VS Code or use the CLI; neither requires an agent chat turn. Codex CLI has a fixture-tested hook adapter, though a real Codex host session remains unverified.

## Optional Codex CLI plugin hooks

The root `plugin.json` selects [Codex hook configuration](hooks/codex-hooks.json). It records supported session start/end and interruption boundaries, plus pre/post boundaries for Bash and file-edit tools. Install or enable the local plugin using [Codex's plugin workflow](https://developers.openai.com/plugins/build/plugins), then review and trust the bundled hooks in Codex before expecting them to run. The helper must be present in the execution environment and Node must be available there. Hook payload handling is fixture-tested; installed Codex CLI 0.159.2 was checked through version/help output on 2026-10-02, but real plugin loading, trust, and hook delivery remain unvalidated. Codex `PostToolUse` also runs after Bash commands that exit non-zero, but the event does not establish success/failure in Chronicle's current adapter. Hosted tools and tool paths that opt out of local hooks are outside capture coverage. See the current [Codex hooks reference](https://developers.openai.com/codex/hooks) for event and trust behavior. The adapter does not provide a custom panel inside Codex; use the VS Code review panel or CLI. The [release audit](RELEASE_AUDIT.md) lists the remaining host checks.

## Storage, limits, and recovery

- Default storage: a `Chronicle` directory under Windows local application data, or `~/.local/share` on other systems. Each repository has a separate store.
- Override with `CHRONICLE_HOME`, outside the recorded repository. Set it consistently for the CLI, extension host, and hooks to share history.
- Snapshots contain supported tracked and non-ignored untracked files. Git-ignored files are omitted. Limits: 1 MiB per file and 32 MiB per checkpoint.
- `.env` variants, private-key filenames, dependency/build directories, symlinks, binary files, non-UTF-8 files, and unsupported Git modes are excluded and reported. The policy is fixed in this prototype.
- Branch output refuses captures with exclusions. Use a small supported text fixture for now.
- Snapshots use JSON metadata and content-addressed blobs. SQLite migration and retention controls are planned.
- `recover` moves interrupted `.tmp` files into a uniquely named recovery folder without deleting them and lists unfinished branch journals for inspection. Run it when Chronicle is idle.
- If `recover` reports a stale PID and no Chronicle process is running, rerun it with `--confirm-stale-lock`. The stale lock file is preserved in the recovery folder. Live locks, unreadable locks, or a busy recorder are never removed.
- Blob publication is atomic; a crash may leave a uniquely named temporary file. Recovery quarantines it, and a later capture can safely publish the same content hash.
- `operations` lists journal records. `reconcile` compares those records with Git's registered worktrees and branches, reports interrupted or missing output, and checks completed output file hashes for later edits. A completed selected branch is expected to be uncommitted and show as Git-dirty; Chronicle distinguishes that intended state from content changed after completion. Reconciliation never changes the journal, branch, or worktree. Open the reported `target` to inspect an interrupted or failed result. `recover` handles storage temp files and stale locks; it does not automatically resume or clean up a branch operation.
- Failed worktrees and worktrees with later edits are retained for manual inspection. Automatic completion is not implemented. Guarded undo affects selected paths in a Chronicle output worktree only; it does not delete branches or worktrees.
- If a lock has an unreadable process ID, stop and inspect it manually; Chronicle will not guess whether its owner is alive.
- Chronicle worktrees are not command sandboxes. Git checkout filters can execute repository-configured programs; only use trusted repositories. Chronicle disables Git lifecycle hooks for its internal commands.

Nothing is automatically pushed, uploaded, committed, or sent to a model. Recorded files are private local artifacts, but the prototype does not provide encryption or configurable secret scanning.
