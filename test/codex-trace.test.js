'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { inspectCodexTrace } = require('../src/codex-trace');

const cassette = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'fixtures', 'simulated-tools', 'issue-tracker.json'), 'utf8'));
const item = (index, status) => ({
  id: `item_${index + 1}`, type: 'mcp_tool_call', server: 'chronicle_replay',
  tool: cassette.calls[index].tool, arguments: cassette.calls[index].input, status,
  ...(status === 'completed' ? { result: { content: [{ type: 'text', text: JSON.stringify(cassette.calls[index].response) }] } } : {})
});
const complete = () => [
  { type: 'thread.started' }, { type: 'turn.started' },
  { type: 'item.started', item: item(0, 'in_progress') }, { type: 'item.completed', item: item(0, 'completed') },
  { type: 'item.started', item: item(1, 'in_progress') }, { type: 'item.completed', item: item(1, 'completed') },
  { type: 'turn.completed' }
];
const bytes = events => Buffer.from(events.map(event => JSON.stringify(event)).join('\n') + '\n');

test('Codex trace inspector checks ordered fixture calls and refuses ambiguous host outcomes', t => {
  const accepted = inspectCodexTrace(bytes(complete()), cassette);
  assert.deepEqual(accepted, { status: 'host-reported-match', matchedCalls: 2, expectedCalls: 2,
    failedCalls: 0, otherToolItems: 0, hostErrorItems: 0, pendingCalls: 0,
    traceStructureValid: true, traceCallsMatchCassette: true });
  assert.equal(JSON.stringify(accepted).includes('README headings'), false);

  const failed = complete();
  failed[3] = { type: 'item.completed', item: { ...item(0, 'failed'), result: { content: [{ type: 'text', text: 'SIMULATED_REPLAY_UNMATCHED' }] } } };
  assert.equal(inspectCodexTrace(bytes(failed), cassette).status, 'review-required');
  const drift = complete();
  drift[2].item.arguments = { issueId: 'wrong' };
  drift[3].item.arguments = { issueId: 'wrong' };
  assert.equal(inspectCodexTrace(bytes(drift), cassette).traceCallsMatchCassette, false);
  const extra = complete();
  extra.splice(6, 0, { type: 'item.completed', item: { id: 'item_other', type: 'command_execution', status: 'completed' } });
  assert.equal(inspectCodexTrace(bytes(extra), cassette).otherToolItems, 1);
  assert.equal(inspectCodexTrace(bytes(extra), cassette).status, 'review-required');
  const missing = complete();
  missing.splice(5, 1);
  assert.equal(inspectCodexTrace(bytes(missing), cassette).pendingCalls, 1);
  assert.equal(inspectCodexTrace(bytes(missing), cassette).status, 'review-required');
  const warning = complete();
  warning.splice(2, 0, { type: 'item.completed', item: { id: 'warning', type: 'error' } });
  assert.equal(inspectCodexTrace(bytes(warning), cassette).status, 'review-required');
  assert.throws(() => inspectCodexTrace(Buffer.from('not JSON\n'), cassette), /invalid JSON/);
  assert.throws(() => inspectCodexTrace(Buffer.from('{}'), cassette), /incomplete final line/);

  const tempRoot = fs.realpathSync(os.tmpdir());
  const base = fs.realpathSync(fs.mkdtempSync(path.join(tempRoot, 'chronicle-codex-trace-')));
  assert.ok(base.startsWith(tempRoot + path.sep));
  t.after(() => fs.rmSync(base, { recursive: true, force: true }));
  const trace = path.join(base, 'events.jsonl'), fixture = path.join(base, 'cassette.json');
  fs.writeFileSync(trace, bytes(complete()));
  fs.writeFileSync(fixture, JSON.stringify(cassette));
  const script = path.join(__dirname, '..', 'scripts', 'inspect-codex-trace.js');
  const good = spawnSync(process.execPath, [script, trace, fixture], { encoding: 'utf8' });
  assert.equal(good.status, 0, good.stderr);
  assert.equal(JSON.parse(good.stdout).status, 'host-reported-match');
  fs.writeFileSync(trace, bytes(extra));
  const refused = spawnSync(process.execPath, [script, trace, fixture], { encoding: 'utf8' });
  assert.equal(refused.status, 2, refused.stderr);
  assert.equal(JSON.parse(refused.stdout).status, 'review-required');
  fs.writeFileSync(trace, Buffer.alloc(4 * 1024 * 1024 + 1));
  const oversized = spawnSync(process.execPath, [script, trace, fixture], { encoding: 'utf8' });
  assert.equal(oversized.status, 1);
  assert.equal(oversized.stdout, '');
  fs.writeFileSync(trace, bytes(complete()));
  fs.writeFileSync(fixture, '{PRIVATE_CASSETTE');
  const malformed = spawnSync(process.execPath, [script, trace, fixture], { encoding: 'utf8' });
  assert.equal(malformed.status, 1);
  assert.equal(malformed.stderr.includes('PRIVATE_CASSETTE'), false);
});
