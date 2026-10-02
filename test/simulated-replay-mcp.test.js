'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { Readable, Writable } = require('node:stream');
const { createSimulatedReplayMcp, PROTOCOL_VERSION } = require('../src/simulated-replay-mcp');
const { runStdioReplay } = require('../scripts/simulated-replay-mcp');

const fixturePath = path.join(__dirname, '..', 'fixtures', 'simulated-tools', 'issue-tracker.json');
const scriptPath = path.join(__dirname, '..', 'scripts', 'simulated-replay-mcp.js');
const cassette = () => JSON.parse(fs.readFileSync(fixturePath, 'utf8'));

function request(id, method, params = {}) {
  return { jsonrpc: '2.0', id, method, params };
}

function initialize(server) {
  const response = server.handle(request(1, 'initialize', {
    protocolVersion: PROTOCOL_VERSION,
    capabilities: {},
    clientInfo: { name: 'chronicle-test', version: '1.0.0' }
  }));
  assert.equal(response.result.protocolVersion, PROTOCOL_VERSION);
  assert.equal(server.handle({ jsonrpc: '2.0', method: 'notifications/initialized' }), null);
}

function runWire(input) {
  return spawnSync(process.execPath, [scriptPath], {
    input, encoding: 'utf8', timeout: 5000, maxBuffer: 1024 * 1024,
    windowsHide: true
  });
}

test('legacy fixture MCP adapter initializes, lists read-only tools, and injects cassette responses over stdio', () => {
  const evidence = [];
  const server = createSimulatedReplayMcp(cassette(), { onEvidence: entry => evidence.push(entry) });
  assert.equal(server.handle(request(0, 'tools/list')).error.code, -32002);
  assert.equal(server.handle({ ...request(0, 'server/discover'), _meta: { 'io.modelcontextprotocol/protocolVersion': '2026-07-28' } }).error.code, -32002);
  initialize(server);

  const listed = server.handle(request(2, 'tools/list'));
  assert.deepEqual(listed.result.tools.map(tool => tool.name), ['fixture.issue.lookup', 'fixture.issue.search']);
  assert.ok(listed.result.tools.every(tool => tool.annotations.readOnlyHint && !tool.annotations.openWorldHint));

  const lookup = server.handle(request(3, 'tools/call', { name: 'fixture.issue.lookup', arguments: { issueId: '42' } }));
  assert.deepEqual(JSON.parse(lookup.result.content[0].text), cassette().calls[0].response);
  assert.equal(evidence[0].kind, 'injected-fixture');
  assert.match(evidence[0].responseHash, /^[a-f0-9]{64}$/);
  const search = server.handle(request(4, 'tools/call', { name: 'fixture.issue.search', arguments: { query: 'README headings', limit: 2 } }));
  assert.deepEqual(JSON.parse(search.result.content[0].text), cassette().calls[1].response);
  assert.deepEqual(server.finish(), { fixtureId: 'sample-issue-tracker-v1', consumedCalls: 2, status: 'complete' });

  const messages = [
    request(1, 'initialize', { protocolVersion: PROTOCOL_VERSION, capabilities: {}, clientInfo: { name: 'wire-test', version: '1' } }),
    { jsonrpc: '2.0', method: 'notifications/initialized' },
    request(2, 'tools/list'),
    request(3, 'tools/call', { name: 'fixture.issue.lookup', arguments: { issueId: '42' } }),
    request(4, 'tools/call', { name: 'fixture.issue.search', arguments: { query: 'README headings', limit: 2 } })
  ].map(message => JSON.stringify(message)).join('\n') + '\n';
  const processResult = runWire(messages);
  assert.equal(processResult.status, 0, processResult.stderr);
  const stdoutLines = processResult.stdout.trim().split(/\r?\n/);
  assert.equal(stdoutLines.length, 4);
  assert.ok(stdoutLines.every(line => JSON.parse(line).jsonrpc === '2.0'));
  assert.match(JSON.parse(stdoutLines[2]).result.content[0].text, /Keep headings/);
  assert.match(processResult.stderr, /Chronicle replay evidence .*injected-fixture/);
  assert.match(processResult.stderr, /Chronicle replay complete \(2 cassette calls\)/);
});

test('fixture MCP adapter stops on the first unmatched call without consuming or falling back', () => {
  const server = createSimulatedReplayMcp(cassette());
  initialize(server);
  const mismatch = server.handle(request(2, 'tools/call', { name: 'fixture.issue.lookup', arguments: { issueId: 'other' } }));
  assert.equal(mismatch.result.isError, true);
  assert.match(mismatch.result.content[0].text, /SIMULATED_REPLAY_UNMATCHED/);
  assert.equal(server.position, 0);
  const afterStop = server.handle(request(3, 'tools/call', { name: 'fixture.issue.lookup', arguments: { issueId: '42' } }));
  assert.equal(afterStop.result.isError, true);
  assert.equal(server.position, 0);
  assert.equal(server.stopped, true);
  assert.throws(() => server.finish(), { code: 'SIMULATED_REPLAY_UNMATCHED' });
});

test('stdio session rejects calls after a mismatch and exits unsuccessfully when the host closes it', () => {
  const messages = [
    request(1, 'initialize', { protocolVersion: PROTOCOL_VERSION, capabilities: {}, clientInfo: { name: 'wire-test', version: '1' } }),
    { jsonrpc: '2.0', method: 'notifications/initialized' },
    request(2, 'tools/call', { name: 'fixture.issue.lookup', arguments: { issueId: 'other' } }),
    request(3, 'tools/call', { name: 'fixture.issue.lookup', arguments: { issueId: '42' } })
  ].map(message => JSON.stringify(message)).join('\n') + '\n';
  const result = runWire(messages);
  assert.equal(result.status, 1);
  const replies = result.stdout.trim().split(/\r?\n/).map(line => JSON.parse(line));
  assert.equal(replies.length, 3);
  assert.equal(replies[1].result.isError, true);
  assert.match(replies[1].result.content[0].text, /SIMULATED_REPLAY_UNMATCHED/);
  assert.equal(replies[2].result.isError, true);
  assert.match(replies[2].result.content[0].text, /Replay has stopped/);
  assert.match(result.stderr, /Replay did not complete \(SIMULATED_REPLAY_UNMATCHED\)/);
});

test('fixture MCP adapter treats tools outside the listed cassette as protocol errors and stops', () => {
  const server = createSimulatedReplayMcp(cassette());
  initialize(server);
  const response = server.handle(request(2, 'tools/call', { name: 'network.fetch', arguments: { url: 'https://example.invalid' } }));
  assert.equal(response.error.code, -32602);
  assert.match(response.error.message, /no live fallback/);
  assert.equal(server.position, 0);
  assert.equal(server.stopped, true);
  assert.throws(() => server.finish(), { code: 'SIMULATED_REPLAY_TOOL_NOT_ALLOWED' });
});

test('stdio server reports incomplete cassette consumption and malformed requests clearly', () => {
  const messages = [
    '{bad json',
    JSON.stringify(request(1, 'initialize', { protocolVersion: PROTOCOL_VERSION, capabilities: {}, clientInfo: { name: 'wire-test', version: '1' } })),
    JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' })
  ].join('\n') + '\n';
  const result = runWire(messages);
  assert.equal(result.status, 1);
  const replies = result.stdout.trim().split(/\r?\n/).map(line => JSON.parse(line));
  assert.equal(replies[0].error.code, -32700);
  assert.equal(replies[1].result.serverInfo.name, 'chronicle-simulated-replay');
  assert.match(result.stderr, /Replay did not complete \(SIMULATED_REPLAY_INCOMPLETE\)/);
});

test('stdio server bounds individual messages and emits only JSON-RPC on stdout', () => {
  const result = runWire('x'.repeat(64 * 1024 + 1) + '\n');
  assert.equal(result.status, 1);
  const reply = JSON.parse(result.stdout.trim());
  assert.equal(reply.error.code, -32600);
  assert.match(result.stderr, /64 KiB limit/);
});

test('stdio server pauses request processing while stdout is backpressured', async () => {
  const requestLines = Array.from({ length: 40 }, (_, id) => JSON.stringify(request(id, 'ping'))).join('\n') + '\n';
  const input = Readable.from([Buffer.from(requestLines)]);
  const replies = [];
  const observedPaused = [];
  const output = new Writable({
    highWaterMark: 1,
    write(chunk, encoding, callback) {
      replies.push(String(chunk));
      setImmediate(() => { observedPaused.push(input.isPaused()); callback(); });
    }
  });
  const diagnostics = new Writable({ write(chunk, encoding, callback) { callback(); } });

  const exitCode = await runStdioReplay({ input, output, errorOutput: diagnostics, cassette: cassette() });
  assert.equal(exitCode, 1); // Ping-only client never completed MCP initialization.
  assert.equal(replies.length, 40);
  assert.ok(observedPaused.length > 0);
  assert.ok(observedPaused.every(Boolean), 'input should remain paused until each response drains');
});

test('stdio server exits with a failure when the MCP client closes its output pipe', async () => {
  const input = Readable.from([Buffer.from(JSON.stringify(request(1, 'ping')) + '\n')]);
  let diagnostics = '';
  const output = new Writable({
    write(chunk, encoding, callback) {
      const error = new Error('client closed output');
      error.code = 'EPIPE';
      callback(error);
    }
  });
  const errorOutput = new Writable({ write(chunk, encoding, callback) { diagnostics += String(chunk); callback(); } });

  assert.equal(await runStdioReplay({ input, output, errorOutput, cassette: cassette() }), 1);
  assert.match(diagnostics, /MCP output failed \(EPIPE\)/);
});
