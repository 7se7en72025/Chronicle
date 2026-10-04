'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const { inspectCodexTrace } = require('../src/codex-trace');
const { createSimulatedReplay } = require('../src/simulated-replay');

const cassetteBytes = fs.readFileSync(path.join(__dirname, '..', 'fixtures', 'simulated-tools', 'issue-tracker.json'));
const cassette = JSON.parse(cassetteBytes.toString('utf8'));
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
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
    finishCalls: 0, failedCalls: 0, otherToolItems: 0, hostErrorItems: 0, pendingCalls: 0,
    traceStructureValid: true, traceCallsMatchCassette: true,
    coverage: { classification: 'unknown', reasons: ['completion-receipt-unavailable', 'host-diagnostics-unavailable'] } });
  assert.equal(JSON.stringify(accepted).includes('README headings'), false);

  const failed = complete();
  failed[3] = { type: 'item.completed', item: { ...item(0, 'failed'), result: { content: [{ type: 'text', text: 'SIMULATED_REPLAY_UNMATCHED' }] } } };
  assert.equal(inspectCodexTrace(bytes(failed), cassette).status, 'review-required');
  const drift = complete();
  drift[2].item.arguments = { issueId: 'wrong' };
  drift[3].item.arguments = { issueId: 'wrong' };
  assert.equal(inspectCodexTrace(bytes(drift), cassette).traceCallsMatchCassette, false);
  const reordered = complete();
  reordered[4].item.arguments = { limit: 2, query: 'README headings' };
  reordered[5].item.arguments = { limit: 2, query: 'README headings' };
  assert.equal(inspectCodexTrace(bytes(reordered), cassette).status, 'host-reported-match');
  const extra = complete();
  extra.splice(6, 0, { type: 'item.completed', item: { id: 'item_other', type: 'command_execution', status: 'completed' } });
  assert.equal(inspectCodexTrace(bytes(extra), cassette).otherToolItems, 1);
  assert.equal(inspectCodexTrace(bytes(extra), cassette).status, 'review-required');
  assert.equal(inspectCodexTrace(bytes(extra), cassette).coverage.classification, 'unknown');
  const missing = complete();
  missing.splice(5, 1);
  assert.equal(inspectCodexTrace(bytes(missing), cassette).pendingCalls, 1);
  assert.equal(inspectCodexTrace(bytes(missing), cassette).status, 'review-required');
  assert.equal(inspectCodexTrace(bytes(missing), cassette).coverage.classification, 'unknown');
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

test('Codex trace inspector checks consistency with a completed fixture server sidecar', t => {
  const runId = crypto.randomUUID();
  const replay = createSimulatedReplay(cassette);
  const cassetteHash = hash(cassetteBytes);
  const lines = cassette.calls.map((call, index) => JSON.stringify({
    ...replay.invoke(call.tool, call.input).evidence, runId, cassetteHash, sequence: index + 1
  }) + '\n').join('');
  const completion = { schema: 1, kind: 'chronicle.fixture-server-completion', runId,
    cassetteHash, consumedCalls: 2, evidenceHash: hash(lines) };
  const serverEvidence = { sidecarBytes: Buffer.from(lines), completionBytes: Buffer.from(JSON.stringify(completion) + '\n'), cassetteBytes };
  const withFinish = complete();
  withFinish.splice(-1, 0,
    { type: 'item.started', item: { id: 'item_finish', type: 'mcp_tool_call', server: 'chronicle_replay', tool: 'fixture.replay.finish', arguments: {}, status: 'in_progress' } },
    { type: 'item.completed', item: { id: 'item_finish', type: 'mcp_tool_call', server: 'chronicle_replay', tool: 'fixture.replay.finish', arguments: {}, status: 'completed', result: { content: [{ type: 'text', text: JSON.stringify(completion) }] } } });
  const accepted = inspectCodexTrace(bytes(withFinish), cassette, 'chronicle_replay', serverEvidence);
  assert.equal(accepted.status, 'review-required');
  assert.equal(accepted.serverEvidenceMatches, true);
  assert.equal(accepted.finishCalls, 1);
  assert.equal(accepted.coverage.classification, 'unknown');
  assert.ok(accepted.coverage.reasons.includes('host-diagnostics-unavailable'));
  const benignDiagnostics = Buffer.from('Reading additional input from stdin...\r\n');
  const consistent = inspectCodexTrace(bytes(withFinish), cassette, 'chronicle_replay', serverEvidence, benignDiagnostics);
  assert.equal(consistent.status, 'host-server-evidence-consistent');
  assert.deepEqual(consistent.coverage, { classification: 'partial-observed', reasons: [] });
  const duplicateDiagnostic = inspectCodexTrace(bytes(withFinish), cassette, 'chronicle_replay', serverEvidence,
    Buffer.concat([benignDiagnostics, benignDiagnostics]));
  assert.equal(duplicateDiagnostic.status, 'review-required');
  assert.equal(duplicateDiagnostic.coverage.classification, 'unknown');
  const hiddenToolError = Buffer.from('Reading additional input from stdin...\nERROR codex_core::tools::router: PRIVATE_COMMAND rejected by policy\n');
  const withError = inspectCodexTrace(bytes(withFinish), cassette, 'chronicle_replay', serverEvidence, hiddenToolError);
  assert.equal(withError.status, 'review-required');
  assert.equal(withError.hostDiagnosticLines, 1);
  assert.equal(withError.coverage.classification, 'unknown');
  assert.equal(JSON.stringify(withError).includes('PRIVATE_COMMAND'), false);
  assert.equal(inspectCodexTrace(bytes(complete()), cassette, 'chronicle_replay', serverEvidence).status, 'review-required');
  assert.equal(inspectCodexTrace(bytes(withFinish), cassette).status, 'review-required');
  const wrongReceipt = structuredClone(withFinish);
  wrongReceipt[7].item.result.content[0].text = JSON.stringify({ ...completion, runId: crypto.randomUUID() });
  assert.equal(inspectCodexTrace(bytes(wrongReceipt), cassette, 'chronicle_replay', serverEvidence).serverEvidenceMatches, false);
  const extraFinish = structuredClone(withFinish);
  extraFinish.splice(-1, 0, structuredClone(extraFinish[6]), structuredClone(extraFinish[7]));
  assert.equal(inspectCodexTrace(bytes(extraFinish), cassette, 'chronicle_replay', serverEvidence).status, 'review-required');
  const drifted = { ...serverEvidence, sidecarBytes: Buffer.from(lines.replace('injected-fixture', 'rejected-fixture')) };
  assert.equal(inspectCodexTrace(bytes(withFinish), cassette, 'chronicle_replay', drifted).status, 'review-required');
  const wrongRun = { ...serverEvidence, completionBytes: Buffer.from(JSON.stringify({ ...completion, runId: crypto.randomUUID() }) + '\n') };
  const wrongRunResult = inspectCodexTrace(bytes(withFinish), cassette, 'chronicle_replay', wrongRun);
  assert.equal(wrongRunResult.serverEvidenceMatches, false);
  assert.equal(wrongRunResult.coverage.classification, 'unknown');
  const hostFailed = structuredClone(withFinish);
  hostFailed[3].item.status = 'failed';
  assert.equal(inspectCodexTrace(bytes(hostFailed), cassette, 'chronicle_replay', serverEvidence).status, 'review-required');

  const tempRoot = fs.realpathSync(os.tmpdir());
  const base = fs.realpathSync(fs.mkdtempSync(path.join(tempRoot, 'chronicle-codex-correlation-')));
  assert.ok(base.startsWith(tempRoot + path.sep));
  t.after(() => fs.rmSync(base, { recursive: true, force: true }));
  const paths = ['trace.jsonl', 'cassette.json', 'server.jsonl', 'completion.json', 'stderr.txt'].map(name => path.join(base, name));
  for (const [index, data] of [bytes(withFinish), cassetteBytes, serverEvidence.sidecarBytes, serverEvidence.completionBytes].entries()) {
    fs.writeFileSync(paths[index], data);
  }
  const script = path.join(__dirname, '..', 'scripts', 'inspect-codex-trace.js');
  fs.writeFileSync(paths[4], benignDiagnostics);
  const good = spawnSync(process.execPath, [script, ...paths], { encoding: 'utf8' });
  assert.equal(good.status, 0, good.stderr);
  assert.equal(JSON.parse(good.stdout).status, 'host-server-evidence-consistent');
  assert.equal(JSON.parse(good.stdout).coverage.classification, 'partial-observed');
  fs.writeFileSync(paths[4], hiddenToolError);
  const warned = spawnSync(process.execPath, [script, ...paths], { encoding: 'utf8' });
  assert.equal(warned.status, 2, warned.stderr);
  assert.equal(JSON.parse(warned.stdout).hostDiagnosticLines, 1);
  assert.equal(warned.stdout.includes('PRIVATE_COMMAND'), false);
  fs.writeFileSync(paths[3], wrongRun.completionBytes);
  const refused = spawnSync(process.execPath, [script, ...paths.slice(0, 4)], { encoding: 'utf8' });
  assert.equal(refused.status, 2, refused.stderr);
  assert.equal(JSON.parse(refused.stdout).serverEvidenceMatches, false);
  const missing = spawnSync(process.execPath, [script, ...paths.slice(0, 3), path.join(base, 'PRIVATE_MISSING_MARKER.json')], { encoding: 'utf8' });
  assert.equal(missing.status, 1);
  assert.equal(missing.stdout, '');
  assert.equal(missing.stderr.includes('PRIVATE_MISSING_MARKER'), false);
});
