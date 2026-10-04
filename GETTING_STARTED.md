# Run the first Chronicle prototype

This is a local development prototype, not a published extension. It has no npm runtime dependencies and makes no model or network requests. Requirements: Node.js 20 or later, Git, and optionally VS Code.

## Fast demonstration

From this repository:

```sh
npm test
npm run check
npm run demo
npm run demo:replay
```

The first demo creates a temporary Git fixture, changes 80 lines, selects the hunk containing the wanted 40 changes, and creates a separate output worktree. It prints both locations and retains them for inspection. `npm run demo:replay` injects two deterministic responses from a local cassette. It does not launch an agent or edit your project.

## Experimental fixture MCP server

`scripts/simulated-replay-mcp.js` exposes the bundled cassette as two read-only MCP tools over newline-delimited stdio JSON-RPC. It implements a legacy MCP subset pinned to the `2025-11-25` initialize handshake; it does not implement the `2026-07-28` modern `server/discover` and per-request metadata flow. A dual-era client can detect the legacy server and fall back to initialize; a modern-only client cannot use it. It is not registered in a host plugin. One temporary Codex CLI 0.160.0 session called both fixture tools in order and received the saved responses; persistent host registration, Claude discovery, and a fresh-agent replay remain unverified. Test the protocol with `node --test test/simulated-replay-mcp.test.js` rather than calling a model. See the official [MCP versioning and compatibility rules](https://modelcontextprotocol.io/specification/2026-07-28/basic/versioning) and [stdio binding](https://modelcontextprotocol.io/specification/2026-07-28/basic/transports/stdio).

An MCP host must launch `node` with the absolute path to `scripts/simulated-replay-mcp.js`. The bundled cassette is resolved relative to the script, so the host's working directory does not matter. Launch the script directly, not through `npm run`: npm prints banners to stdout, which is reserved for MCP messages. The server exposes only the fixture's allowlisted read-only tools and consumes responses in cassette order. On a mismatch or unknown tool it marks replay stopped and rejects later tool calls; when the host closes stdin, the process exits unsuccessfully for a stopped or incomplete cassette. It has no live fallback, network client, or model request. An agent host may still spend its normal model usage when the agent chooses to call these tools. No Codex or Claude MCP configuration is currently bundled.

#### Optional host discovery check (Windows PowerShell)

These commands add a local server entry to your host configuration; they do not call a model. Run them from the Chronicle checkout, then open the host without sending a prompt and inspect its MCP panel/list for `chronicle-replay` and the two `fixture.issue.*` tools. In Codex, use `/mcp` in the CLI/IDE; `codex mcp list` shows configured entries, not live discovery. In Claude Code, use `/mcp` in the session. This checks startup and discovery only, not a replayed tool call. The cassette expects two calls, so closing the host before invoking them reports incomplete replay on stderr and exits unsuccessfully. Asking an agent to invoke the tools starts a model-mediated turn and may use credits.

For Codex CLI:

```powershell
$server = (Resolve-Path .\scripts\simulated-replay-mcp.js).Path
codex mcp add chronicle-replay -- node $server
codex mcp list
```

`codex mcp add` writes to the user's Codex configuration. Remove this test entry afterward with `codex mcp remove chronicle-replay`. A zero Codex process exit or `turn.completed` does not prove all fixture calls succeeded: a temporary read-only turn exited zero after a failed MCP call. Inspect each tool item and cassette completion before treating a host run as replay evidence; see [REVIEW.md](REVIEW.md).

For Claude Code:

```powershell
$server = (Resolve-Path .\scripts\simulated-replay-mcp.js).Path
claude mcp add --transport stdio --scope local chronicle-replay -- node $server
claude mcp list
```

Open Claude Code in this checkout and inspect `/mcp`; remove the local test entry afterward with `claude mcp remove chronicle-replay --scope local`. Codex CLI 0.160.0 was checked separately with temporary command-line MCP configuration. It exposed the tools to the model as `fixture_issue_lookup` and `fixture_issue_search`; a later read-only model turn called the dotted MCP tools in cassette order and received both saved responses. Those responses were sent to the Codex service and the turn consumed model usage. Neither check persisted an MCP entry or opened Codex's `/mcp` view. Claude Code discovery remains untested. See the official [Codex MCP guide](https://developers.openai.com/codex/mcp) and [Claude Code local stdio setup](https://code.claude.com/docs/en/mcp#option-3-add-a-local-stdio-server) for current host syntax and trust behavior.

To inspect an existing local Codex `--json` trace against the bundled fixture cassette without a model call, run:

```sh
node /path/to/Chronicle/scripts/inspect-codex-trace.js /path/to/events.jsonl /path/to/Chronicle/fixtures/simulated-tools/issue-tracker.json
```

The read-only inspector prints counts and a `host-reported-match` or `review-required` status, without printing prompts, tool arguments, responses, or stderr text. It also prints `coverage.classification` as `unknown` or `partial-observed`, with fixed reason codes when unknown. Exit 0 for the two-path invocation means only that the visible JSONL contains one completed turn and exactly the cassette's ordered fixture calls with expected responses and no other visible tool/error items; coverage remains `unknown` because there is no completion receipt and stderr input. Pass Codex's native stderr as a third path to include diagnostic-line screening. If an orchestrator also retained the fixture server's child-written evidence sidecar and completion marker, pass those as the third and fourth paths **and stderr as the fifth**. The inspector then requires one visible `fixture.replay.finish` call whose returned run ID and hashes match the server files, with no unexpected stderr diagnostics, for `host-server-evidence-consistent` and `partial-observed`. Missing stderr or mismatched/missing server evidence leaves coverage `unknown`. The finish tool is advertised only when the server has a completion path, and its marker is written after the cassette is consumed and before the tool responds. A plain two-call Codex CLI turn did not produce a marker on host exit; a later explicit-finish turn did. In another read-only turn, a policy-blocked shell attempt appeared only on stderr, so JSONL alone missed it. Exit 2 requires review; exit 1 means input could not be inspected. Local evidence is not a signed host attestation. `partial-observed` does not prove every possible host tool path appears in JSONL or bind an agent run to a branch; the inspector never reports `complete-controlled` or `replay-complete`. Keep raw traces local and out of Git.

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
node /path/to/Chronicle/src/cli.js record-check OPERATION_ID 0 "npm test"
node /path/to/Chronicle/src/cli.js undo OPERATION_ID
node /path/to/Chronicle/src/cli.js reconcile
```

Quote paths containing spaces. The diff command returns hunk IDs and, for multi-edit hunks, change-group IDs. Supply one or more to preview and branch. A change group keeps contiguous replacement lines together; unchanged context separates groups. IDs are tied to the checkpoint pair, so selections from another pair are rejected.

Undo restores only selected paths in Chronicle's separate output worktree to their saved baseline. It checks their current bytes and file modes first, and refuses if the branch gained commits or those paths have staged or later changes. The original recording workspace is untouched; the output branch and worktree remain available. In VS Code, use **Chronicle: Undo Output Operation** and confirm the selected operation. If an undo is interrupted, rerunning it can resume only while each selected path still matches either Chronicle's output or the saved baseline.

Each completed output operation saves a versioned manifest of its source checkpoints, selected change IDs, measured environment, observed host labels, capture gaps, and output file hashes/modes. `compare-operations` prints a local, read-only comparison of two operation manifests, including added, deleted, changed, and identical paths. It does not run tests or an agent. An empty `checks` list means no checks were recorded; `reportedCost: null` means unavailable, not free.

In VS Code, run **Chronicle: Compare Saved Branches** from the Command Palette and choose exactly two completed output branches. The local comparison view shows each branch's recorded environment and coverage, including the count of unpaired Codex tool boundaries recorded when the branch was created, beside a file-by-file hash/mode comparison. Older branches show that count as unavailable. A uniquely bound completed fixture run shows its injected call count; ambiguous or absent fixture evidence and all live-tool activity are unavailable. It does not run tests or an agent; absent check results and costs are labeled unavailable. The checkpoint review shows unpaired tool boundaries separately from capture failures and labels their outcome unknown.

After you run a check yourself in the output workspace, you can record its label and exit code with `record-check` while that workspace still matches Chronicle's saved output and has no staged changes. This only appends developer-reported evidence to the completed operation; Chronicle does not run or verify the command. Exit code zero is shown as “reported pass,” and nonzero as “reported fail.” Keep labels short and omit arguments or secrets.

## Optional Claude Code recording

The repository includes a local Claude plugin manifest and [hook configuration](hooks/hooks.json). It records `SessionStart` and before/success/failure boundaries for `Edit`, `Write`, `Bash`, and `PowerShell`. Other tools, denied operations, concurrent edits, and background changes may not be captured accurately.

With a compatible Claude Code CLI installed, start it in the project you want to record:

```sh
claude --plugin-dir /path/to/Chronicle
```

Restart the session after changing plugin files. Node must be available in the hook environment. Review and enable the plugin through the host's normal trust flow. See the official [plugin documentation](https://code.claude.com/docs/en/plugins) and [hook reference](https://code.claude.com/docs/en/hooks).

Hook payload handling is tested locally, including a failed tool that leaves a partial edit. A real Claude Code session has not been tested on this machine. The hook records limited event identifiers and status, not prompts, tool input/output, or transcript contents. File snapshots can still contain secrets: filename exclusions are not content redaction.

Hook failures write a bounded, local capture-gap record and report the issue on stderr without blocking the agent. Gap records store event identifiers and a fixed reason category; raw prompts, commands, and tool errors are not saved. `gaps` lists them, and the review panel shows gaps in the selected checkpoint interval. Each repository retains at most 1,000 gap entries, after which it records a limit marker. A busy recorder skips capture rather than inventing an exact timeline. Review in VS Code or use the CLI; neither requires an agent chat turn. Codex CLI sessions using temporary inline hooks delivered session lifecycle and fixture MCP pre/post-tool checkpoints. The shipped plugin's trust/loading path and its Bash/file-edit boundaries remain unverified; see [RELEASE_AUDIT.md](RELEASE_AUDIT.md) and [REVIEW.md](REVIEW.md).

## Optional Codex CLI plugin hooks

The Codex compatibility manifest at `.codex-plugin/plugin.json` selects [Codex hook configuration](hooks/codex-hooks.json). It declares session start/end and interruption boundaries plus pre/post boundaries for Bash and file-edit tools. Codex CLI 0.160.0 silently showed zero hooks for the portable root Agent Plugins manifest; the compatibility manifest exposed five hooks and two fixture-only `SessionEnd` checkpoints. This is a narrow observation, not proof of Bash/file-edit capture, SessionStart delivery without a model turn, or exhaustive host coverage. Install or enable the local plugin using [Codex's plugin workflow](https://developers.openai.com/plugins/build/plugins), then review and trust its current hook definition in Codex before expecting callbacks. The helper must be present in the execution environment and Node must be available there. Hook payload handling is fixture-tested. Real Codex CLI session and read-only fixture MCP pre/post checkpoints were also observed using one-off inline hook configuration and storage outside a disposable Git repo. Codex `PostToolUse` can follow a Bash command that exits non-zero, but Chronicle's event is only an observed boundary, not a success/failure result. Hosted tools and tool paths that opt out of local hooks are outside capture coverage. The [current Codex hooks reference](https://developers.openai.com/codex/hooks) and open [Codex issue #47925](https://github.com/openai/codex/issues/47925) explain the event and manifest compatibility limits. The adapter does not provide a custom panel inside Codex; use the VS Code review panel or CLI. The [release audit](RELEASE_AUDIT.md) lists the remaining host checks.

## Storage, limits, and recovery

- Default storage: a `Chronicle` directory under Windows local application data, or `~/.local/share` on other systems. Each repository has a separate store.
- Override with `CHRONICLE_HOME`, outside the recorded repository. Set it consistently for the CLI, extension host, and hooks to share history.
- Snapshots contain supported tracked and non-ignored untracked files. Git-ignored files are omitted. Limits: 1 MiB per file and 32 MiB per checkpoint.
- Hook stdin is limited to 1 MiB of UTF-8 bytes. Invalid input or capture failures produce a fixed stderr diagnostic with exception details omitted; without a trustworthy repository root, Chronicle cannot attach that event to a repository gap record.
- `.env` variants, private-key filenames, dependency/build directories, symlinks, binary files, non-UTF-8 files, and unsupported Git modes are excluded and reported. The policy is fixed in this prototype.
- Branch output refuses captures with exclusions. Use a small supported text fixture for now.
- Snapshots use JSON metadata and content-addressed blobs. Saved blobs are checked as regular files within the 1 MiB file limit when read or reused; damaged entries stop the operation for inspection. SQLite migration and retention controls are planned.
- There is no automatic expiry or delete-history command. Keep the local store private and account for dependent output operations before manually removing any history. [D015](DECISIONS.md#d015--retain-local-evidence-until-explicit-dependency-aware-removal) describes the proposed dependency-aware removal and migration contract; it is not an implemented cleanup workflow.
- `recover` moves interrupted blob, checkpoint, and operation `.tmp` files into a uniquely named recovery folder without deleting them and lists unfinished branch journals. It reports gap `.tmp` names in `unresolvedGapTemps` but leaves those files in place because a gap writer may still be active. Run it when Chronicle is idle.
- `recover-fixture-runs` marks a pending controlled fixture subprocess run failed only when its recorded controller and child PIDs are both absent and no invalid or conflicting child-written sidecar is observed. It retains the cassette and partial evidence. Malformed records, identity/schema mismatches, and atomic replacement temps (including a temp with no published journal) are listed for inspection and left byte-for-byte unchanged. Live, unknown, or conflicting state stays pending for inspection; it never resumes replay or creates a branch.
- `inspect-fixture-evidence <run-id>` reads a controlled subprocess's bounded child-written sidecar and compares its metadata-only event sequence with the journal. `sidecar-ahead` means the child persisted more events than the controller journal; `conflict`, `invalid`, and `unavailable` require manual inspection. This command does not repair the journal, infer success, or bind a branch.
- If `recover` reports a stale PID and no Chronicle process is running, rerun it with `--confirm-stale-lock`. The stale lock file is preserved in the recovery folder. Live locks, unreadable locks, or a busy recorder are never removed.
- Blob publication is atomic; a crash may leave a uniquely named temporary file. Recovery quarantines it, and a later capture can safely publish the same content hash.
- `operations` lists journal records. `reconcile` compares those records with Git's registered worktrees and branches, reports interrupted or missing output, and checks completed output file hashes and staged index changes for later edits. A completed selected branch is expected to be uncommitted and show as Git-dirty; Chronicle distinguishes that intended state from content or index changes after completion. Reconciliation never changes the journal, branch, or worktree. Open the reported `target` to inspect an interrupted or failed result. `recover` handles storage temp files and stale locks; it does not automatically resume or clean up a branch operation.
- Failed worktrees and worktrees with later edits are retained for manual inspection. Automatic completion is not implemented. Guarded undo affects selected paths in a Chronicle output worktree only; it does not delete branches or worktrees.
- If a lock has an unreadable process ID, stop and inspect it manually; Chronicle will not guess whether its owner is alive.
- Chronicle worktrees are not command sandboxes. Git checkout filters can execute repository-configured programs; only use trusted repositories. Chronicle disables Git lifecycle hooks for its internal commands.

Nothing is automatically pushed, uploaded, committed, or sent to a model. Recorded files are private local artifacts, but the prototype does not provide encryption or configurable secret scanning.
