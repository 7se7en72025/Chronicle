'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createSimulatedReplay } = require('../src/simulated-replay');

const fixturePath = path.join(__dirname, '..', 'fixtures', 'simulated-tools', 'issue-tracker.json');
const loadCassette = () => JSON.parse(fs.readFileSync(fixturePath, 'utf8'));

test('simulated replay injects the same allowlisted fixture responses deterministically', () => {
  const cassette = loadCassette();
  const first = createSimulatedReplay(cassette);
  const a = first.invoke('fixture.issue.lookup', { issueId: '42' });
  const b = first.invoke('fixture.issue.search', { query: 'README headings', limit: 2 });
  const complete = first.assertComplete();

  a.response.title = 'caller mutation';
  assert.equal(cassette.calls[0].response.title, 'Keep headings when selecting README edits');
  assert.equal(a.evidence.kind, 'injected-fixture');
  assert.equal(a.evidence.callId, 'lookup-42');
  assert.match(a.evidence.requestHash, /^[a-f0-9]{64}$/);
  assert.match(a.evidence.responseHash, /^[a-f0-9]{64}$/);
  assert.equal(b.response.results[0].path, 'README.md');
  assert.deepEqual(complete, { fixtureId: 'sample-issue-tracker-v1', consumedCalls: 2, status: 'complete' });

  const second = createSimulatedReplay(cassette);
  const replayed = [
    second.invoke('fixture.issue.lookup', { issueId: '42' }),
    second.invoke('fixture.issue.search', { limit: 2, query: 'README headings' })
  ];
  second.assertComplete();
  assert.deepEqual(replayed.map(item => item.response), [cassette.calls[0].response, cassette.calls[1].response]);
});

test('simulated replay fails closed on an unmatched call without consuming the next fixture event', () => {
  const replay = createSimulatedReplay(loadCassette());
  assert.throws(() => replay.invoke('fixture.issue.lookup', { issueId: 'different' }), { code: 'SIMULATED_REPLAY_UNMATCHED' });
  assert.equal(replay.position, 0);
  const matching = replay.invoke('fixture.issue.lookup', { issueId: '42' });
  assert.equal(matching.response.issueId, '42');
  assert.equal(replay.position, 1);
  assert.throws(() => replay.assertComplete(), { code: 'SIMULATED_REPLAY_INCOMPLETE' });
});

test('simulated replay refuses tools outside the fixture allowlist and reports incomplete sequences', () => {
  const replay = createSimulatedReplay(loadCassette());
  assert.throws(() => replay.invoke('network.fetch', { url: 'https://example.invalid' }), { code: 'SIMULATED_REPLAY_TOOL_NOT_ALLOWED' });
  assert.throws(() => replay.assertComplete(), { code: 'SIMULATED_REPLAY_INCOMPLETE' });
  replay.invoke('fixture.issue.lookup', { issueId: '42' });
  replay.invoke('fixture.issue.search', { query: 'README headings', limit: 2 });
  replay.assertComplete();
  assert.throws(() => replay.invoke('fixture.issue.search', { query: 'README headings', limit: 2 }), { code: 'SIMULATED_REPLAY_EXHAUSTED' });
});

test('simulated replay rejects malformed schemas, unknown fixture tools, and oversized cassettes', () => {
  const cassette = loadCassette();
  assert.throws(() => createSimulatedReplay({ ...cassette, schema: 2 }), { code: 'SIMULATED_REPLAY_INVALID_CASSETTE' });
  assert.throws(() => createSimulatedReplay({ ...cassette, allowedTools: ['network.fetch'] }), { code: 'SIMULATED_REPLAY_INVALID_CASSETTE' });
  assert.throws(() => createSimulatedReplay({ ...cassette, padding: 'x'.repeat(1024 * 1024) }), { code: 'SIMULATED_REPLAY_INVALID_CASSETTE' });
  const tooManyCalls = Array.from({ length: 257 }, (_, index) => ({ id: `call-${index}`, tool: 'fixture.issue.lookup', input: { issueId: String(index) }, response: {} }));
  assert.throws(() => createSimulatedReplay({ ...cassette, calls: tooManyCalls }), { code: 'SIMULATED_REPLAY_INVALID_CASSETTE' });
  assert.throws(() => createSimulatedReplay({ ...cassette, calls: [{ ...cassette.calls[0], response: { broken: undefined } }] }), { code: 'SIMULATED_REPLAY_INVALID_JSON' });
});
