# Chronicle

A local debugging workspace for coding agents: inspect a recorded failure, restore a supported checkpoint into an isolated branch, compare the outcome, and save the verified fix as a regression test.

**Record → inspect → branch → compare → keep the fix.**

Chronicle is an early, local-first MVP built with React, TypeScript, Node.js and Playwright. It includes a controlled coding-agent demo that works without a model API key. Real AI-agent integrations and hosted collaboration are future work.

## Run locally

Requires Node.js 22.12+ (Node 24 recommended).

```sh
npm install
npm run dev
```

Open **http://127.0.0.1:5173**. The local API listens on port 4317. First startup records a failed run and a repaired branch; subsequent starts reuse saved data. Edge or Chrome is used for headless screenshots and browser checks. If neither is available, run `npx playwright install chromium`. Capture failures are visible in the inspector; file snapshots and source-contract checks still work.

```sh
npm test
npm run build
npm start
```

The production build is served at **http://127.0.0.1:4317**. The server binds to loopback only. `PORT` and `CHRONICLE_DATA_DIR` can override the API port and storage directory; the development proxy assumes port 4317.

## Try the demo

1. Open the failed **Build a project dashboard** run. The timeline records what the agent read, its tool arguments, source changes, screenshots and assertion results.
2. Select **Read authentication context**, before the bad edit, and choose **Branch from here**.
3. Use the suggested instruction to preserve authentication. Chronicle copies the checkpoint into a separate workspace and executes the remaining controlled steps.
4. Compare branches: the original allows anonymous access and exposes another user's project; the repair keeps the session guard and ownership filter.
5. Save the passing branch as a regression test, then open **Regression suite** and run the suite.
6. Leave a checkpoint note, copy its local link, or export a JSON bug capsule.

## Implemented

- Durable timeline of tool actions, arguments, observations, instructions, hashes and timings.
- Real isolated workspace directories with versioned file, fixture database and recorded agent-context snapshots at tool boundaries.
- Real headless-browser screenshots, JavaScript-error detection, project-ownership checks, sign-in checks and a new-project form smoke check.
- Timeline scrubber, recorded playback, workspace file diffs, agent-context inspector and restoration coverage.
- Checkpoint branching with an instruction intervention, independent workspaces and verified comparison.
- Context comparison, contract results and local model-cost reporting ($0; no model call is made).
- Passing-run regression capture, original-fixture reruns, persistent results and checkpoint notes.
- JSON evidence capsule exports and links to exact checkpoints within this local installation.
- Responsive interface, keyboard search, modal focus management and reduced-motion support.

## Scope and boundaries

**This is an executable MVP with a deterministic demo adapter, not a general AI coding agent.** The adapter deliberately makes one reproducible authentication mistake. A branch recognizes instructions such as “preserve authentication” and executes the supported repair; unrelated instructions leave the original bug intact. No LLM API is connected and no model tokens are billed. Integrating a real agent requires recording its actual tool boundaries and storing its resumable state behind the same event interface.

The controlled environment is a small Folio app. Its database is a JSON fixture, its writes are sample-source changes, and its browser is reconstructed from the checkpoint's source, fixture and storage state. **It does not restore a live browser process, JavaScript heap, arbitrary remote backend or external side effect.** Checkpoint snapshots are full copies suitable for this small fixture. Screenshot recording is supported; video recording is not.

Regression-suite reruns exercise source-contract checks against the original fixture using the controlled adapter. Browser checks run during recorded agent experiments; they are shown separately and are not silently claimed to have run in the regression suite. All tests check application behavior rather than trusting an agent's success message. New-project form writes happen only in the isolated page and do not persist to an external service.

Capsules are JSON evidence exports for this fixture, with local screenshot references. Import, embedded binary screenshots, secret redaction for real credentials and remote execution are not implemented. Collaboration is checkpoint notes and links within the same local installation; hosted accounts, authorization and multiplayer presence are not implemented. The UI labels this scope.

This runner accepts only controlled fixture tools. Its VM-based source checks and browser context **are not a security boundary for arbitrary untrusted code**. Do not expose the server publicly or connect production credentials. A production agent integration needs OS/container isolation, an authenticated API, storage quotas, content redaction, tool-specific action receipts and verified environment restoration.

## Structure

```text
src/                 React / TypeScript workspace UI
server/engine.mjs    Recorder, checkpoints, branches, fixtures, regression suite
server/browser.mjs   Playwright evidence capture and browser verification
server/fixture.mjs   Controlled application and reproducible failed edit
server/index.mjs     Local HTTP API and sample-app checkpoint serving
tests/               Recorder, isolation, persistence and regression invariants
.chronicle/          Ignored durable recordings, artifacts and isolated workspaces
```

The storage file is written atomically after each checkpoint. Mutations are serialized within this server process. This local MVP is single-process; concurrent server instances sharing one data directory are unsupported. Interrupted runs are marked as interrupted on restart. Regression tests and notes are retained across restarts.

## Validation

`npm test` covers the reproducible failure, independent branches, interventions after a failure, unrelated instructions, regression detection, capsule contents, persistent notes, invalid checkpoints and browser-check failure propagation. `npm run build` checks TypeScript and produces the production interface.

## Next integration

Replace the controlled adapter with one coding agent integration, keep the recorder's evidence format, and restore agent/tool state at explicit checkpoints. Add container-backed execution, a transactional database and artifact storage before supporting external workspaces or hosted teams. General agent branching and replay can be supplied by a framework such as LangGraph; Chronicle's additional responsibility remains environment restoration and useful evidence comparison.
