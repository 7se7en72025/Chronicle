#!/usr/bin/env node
'use strict';
const { Chronicle } = require('./engine');

function main(args) {
  const [command, ...rest] = args;
  if (!command || command === 'help' || command === '--help') {
    console.log('Chronicle — local file checkpoints, no model calls\n\nRun inside a Git repository with at least one commit:\n  node /path/to/Chronicle/src/cli.js capture "Before agent"\n  node /path/to/Chronicle/src/cli.js list\n  node /path/to/Chronicle/src/cli.js diff <before-id> <after-id>\n  node /path/to/Chronicle/src/cli.js gaps\n  node /path/to/Chronicle/src/cli.js preview <before-id> <after-id> <hunk-id> ...\n  node /path/to/Chronicle/src/cli.js branch <before-id> <after-id> chronicle/my-selection <hunk-id> ...\n  node /path/to/Chronicle/src/cli.js operations\n  node /path/to/Chronicle/src/cli.js recover [--confirm-stale-lock]\n\nSnapshots: per-user application data, or CHRONICLE_HOME outside the repo.');
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
  else if (command === 'recover') result = engine.recoverStorage(rest.includes('--confirm-stale-lock'));
  else throw new Error('Unknown command. Run with --help.');
  console.log(JSON.stringify(result, null, 2));
}
if (require.main === module) { try { main(process.argv.slice(2)); } catch (error) { console.error('Chronicle: ' + error.message); process.exitCode = 1; } }
module.exports = { main };
