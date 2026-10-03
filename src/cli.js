#!/usr/bin/env node
'use strict';
const { Chronicle } = require('./engine');

function main(args) {
  const [command, ...rest] = args;
  if (!command || command === 'help' || command === '--help') {
    console.log('Chronicle — local file checkpoints, no model calls\n\nRun inside a Git repository with at least one commit:\n  node /path/to/Chronicle/src/cli.js capture "Before agent"\n  node /path/to/Chronicle/src/cli.js list\n  node /path/to/Chronicle/src/cli.js diff <before-id> <after-id>\n  node /path/to/Chronicle/src/cli.js gaps\n  node /path/to/Chronicle/src/cli.js preview <before-id> <after-id> <hunk-or-group-id> ...\n  node /path/to/Chronicle/src/cli.js branch <before-id> <after-id> chronicle/my-selection <hunk-or-group-id> ...\n  node /path/to/Chronicle/src/cli.js operations\n  node /path/to/Chronicle/src/cli.js compare-operations <first-operation-id> <second-operation-id>\n  node /path/to/Chronicle/src/cli.js record-check <operation-id> <exit-code> <check-label>\n  node /path/to/Chronicle/src/cli.js undo <operation-id>   # guarded; output worktree only\n  node /path/to/Chronicle/src/cli.js reconcile\n  node /path/to/Chronicle/src/cli.js recover [--confirm-stale-lock]\n\nUndo restores selected paths in Chronicle’s output worktree only. It refuses if those paths changed or were staged, or if the branch has new commits.\nSnapshots: per-user application data, or CHRONICLE_HOME outside the repo.');
    console.log('  node /path/to/Chronicle/src/cli.js recover-fixture-runs   # mark proven abandoned subprocess runs failed');
    return;
  }
  const engine = new Chronicle(process.cwd());
  let result;
  if (command === 'capture') result = engine.capture(rest.join(' ') || 'Manual checkpoint');
  else if (command === 'list') result = engine.list().map(({ id, label, createdAt, excluded }) => ({ id, label, createdAt, excluded }));
  else if (command === 'gaps') result = engine.gaps();
  else if (command === 'diff') result = engine.compare(rest[0], rest[1]);
  else if (command === 'preview') result = engine.preview(rest[0], rest[1], rest.slice(2));
  else if (command === 'branch') result = engine.createBranch(rest[0], rest[1], rest.slice(3), rest[2]);
  else if (command === 'operations') result = engine.operations();
  else if (command === 'compare-operations') result = engine.compareOperations(rest[0], rest[1]);
  else if (command === 'record-check') result = engine.recordCheck(rest[0], rest.slice(2).join(' '), Number(rest[1]));
  else if (command === 'undo') result = engine.undoOperation(rest[0]);
  else if (command === 'reconcile') result = engine.reconcileOperations();
  else if (command === 'recover') result = engine.recoverStorage(rest.includes('--confirm-stale-lock'));
  else if (command === 'recover-fixture-runs') result = engine.recoverFixtureRuns();
  else throw new Error('Unknown command. Run with --help.');
  console.log(JSON.stringify(result, null, 2));
}
if (require.main === module) { try { main(process.argv.slice(2)); } catch (error) { console.error('Chronicle: ' + error.message); process.exitCode = 1; } }
module.exports = { main };
