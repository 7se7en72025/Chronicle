'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const { Readable, Writable, PassThrough } = require('node:stream');
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

test('fixture server writes a fsynced completion marker only after consuming the cassette', t => {
  const tempRoot = fs.realpathSync(os.tmpdir());
  const base = fs.realpathSync(fs.mkdtempSync(path.join(tempRoot, 'chronicle-mcp-completion-')));
  assert.ok(base.startsWith(tempRoot + path.sep));
  t.after(() => fs.rmSync(base, { recursive: true, force: true }));
  const cassetteBytes = fs.readFileSync(fixturePath);
  const cassetteHash = crypto.createHash('sha256').update(cassetteBytes).digest('hex');
  const invoke = (messages, name) => {
    const runId = crypto.randomUUID();
    const launch = path.join(base, name + '.launch.json');
    const evidence = path.join(base, name + '.evidence.jsonl');
    const completion = path.join(base, name + '.completion.json');
    const result = spawnSync(process.execPath, [scriptPath, fixturePath, launch, runId, evidence, completion], {
      input: messages.map(message => JSON.stringify(message)).join('\n') + '\n',
      encoding: 'utf8', timeout: 5000, maxBuffer: 1024 * 1024, windowsHide: true
    });
    return { result, runId, launch, evidence, completion };
  };
  const setup = [
    request(1, 'initialize', { protocolVersion: PROTOCOL_VERSION, capabilities: {}, clientInfo: { name: 'wire-test', version: '1' } }),
    { jsonrpc: '2.0', method: 'notifications/initialized' }
  ];
  const successful = invoke([...setup,
    request(2, 'tools/call', { name: 'fixture.issue.lookup', arguments: { issueId: '42' } }),
    request(3, 'tools/call', { name: 'fixture.issue.search', arguments: { query: 'README headings', limit: 2 } })
  ], 'complete');
  assert.equal(successful.result.status, 0, successful.result.stderr);
  const lines = fs.readFileSync(successful.evidence, 'utf8');
  assert.equal(lines.trim().split('\n').length, 2);
  const marker = JSON.parse(fs.readFileSync(successful.completion, 'utf8'));
  assert.deepEqual(marker, { schema: 1, kind: 'chronicle.fixture-server-completion', runId: successful.runId,
    cassetteHash, consumedCalls: 2, evidenceHash: crypto.createHash('sha256').update(lines).digest('hex') });
  assert.equal(JSON.parse(fs.readFileSync(successful.launch, 'utf8')).runId, successful.runId);

  const incomplete = invoke([...setup,
    request(2, 'tools/call', { name: 'fixture.issue.lookup', arguments: { issueId: '42' } })
  ], 'incomplete');
  assert.equal(incomplete.result.status, 1);
  assert.equal(fs.existsSync(incomplete.completion), false);
  assert.equal(fs.readFileSync(incomplete.evidence, 'utf8').trim().split('\n').length, 1);

  const rejected = invoke([...setup,
    request(2, 'tools/call', { name: 'fixture.issue.lookup', arguments: { issueId: 'wrong' } })
  ], 'rejected');
  assert.equal(rejected.result.status, 1);
  assert.equal(fs.existsSync(rejected.completion), false);
  assert.match(fs.readFileSync(rejected.evidence, 'utf8'), /rejected-fixture/);
});

test('fixture MCP launcher refuses an oversized cassette before accepting calls', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'chronicle-cassette-limit-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const large = path.join(dir, 'large.json');
  fs.writeFileSync(large, Buffer.alloc(1024 * 1024 + 1, 65));
  const result = spawnSync(process.execPath, [scriptPath, large], {
    input: JSON.stringify(request(1, 'initialize', { protocolVersion: PROTOCOL_VERSION,
      capabilities: {}, clientInfo: { name: 'test', version: '1' } })) + '\n',
    encoding: 'utf8', timeout: 5000, maxBuffer: 1024 * 1024, windowsHide: true
  });
  assert.equal(result.status, 1);
  assert.equal(result.stdout, '');
  assert.match(result.stderr, /Chronicle replay server failed to start/);
  assert.equal(fs.statSync(large).size, 1024 * 1024 + 1);

  const malformed = path.join(dir, 'malformed.json');
  const bytes = fs.readFileSync(fixturePath);
  bytes[bytes.indexOf(Buffer.from('sample-issue-tracker-v1'))] = 0xff;
  fs.writeFileSync(malformed, bytes);
  const invalid = spawnSync(process.execPath, [scriptPath, malformed], {
    input: '', encoding: 'utf8', timeout: 5000, maxBuffer: 1024 * 1024, windowsHide: true
  });
  assert.equal(invalid.status, 1);
  assert.equal(invalid.stdout, '');
  assert.match(invalid.stderr, /Chronicle replay server failed to start/);
});

test('fixture MCP adapter stops on the first unmatched call without consuming or falling back', () => {
  const evidence = [];
  const server = createSimulatedReplayMcp(cassette(), { onEvidence: entry => evidence.push(entry) });
  initialize(server);
  const mismatch = server.handle(request(2, 'tools/call', { name: 'fixture.issue.lookup', arguments: { issueId: 'other' } }));
  assert.equal(mismatch.result.isError, true);
  assert.match(mismatch.result.content[0].text, /SIMULATED_REPLAY_UNMATCHED/);
  assert.equal(server.position, 0);
  const afterStop = server.handle(request(3, 'tools/call', { name: 'fixture.issue.lookup', arguments: { issueId: '42' } }));
  assert.equal(afterStop.result.isError, true);
  assert.equal(server.position, 0);
  assert.equal(server.stopped, true);
  assert.deepEqual(evidence, [{ kind: 'rejected-fixture', fixtureId: 'sample-issue-tracker-v1', code: 'SIMULATED_REPLAY_UNMATCHED', position: 0 }]);
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
  assert.match(result.stderr, /Chronicle replay evidence .*"kind":"rejected-fixture".*"code":"SIMULATED_REPLAY_UNMATCHED".*"position":0/);
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

test('fixture MCP adapter stops after a malformed tool call and preserves the next cassette response', () => {
  const server = createSimulatedReplayMcp(cassette());
  initialize(server);
  const malformed = server.handle(request(2, 'tools/call', { name: 'fixture.issue.lookup' }));
  assert.equal(malformed.error.code, -32602);
  assert.equal(server.stopped, true);
  assert.equal(server.position, 0);
  const later = server.handle(request(3, 'tools/call', { name: 'fixture.issue.lookup', arguments: { issueId: '42' } }));
  assert.equal(later.result.isError, true);
  assert.match(later.result.content[0].text, /Replay has stopped/);
  assert.equal(server.position, 0);
  assert.throws(() => server.finish(), { code: 'SIMULATED_REPLAY_INVALID_CALL' });

  const messages = [
    request(1, 'initialize', { protocolVersion: PROTOCOL_VERSION, capabilities: {}, clientInfo: { name: 'wire-test', version: '1' } }),
    { jsonrpc: '2.0', method: 'notifications/initialized' },
    request(2, 'tools/call', { name: 'fixture.issue.lookup' }),
    request(3, 'tools/call', { name: 'fixture.issue.lookup', arguments: { issueId: '42' } })
  ].map(message => JSON.stringify(message)).join('\n') + '\n';
  const result = runWire(messages);
  assert.equal(result.status, 1);
  const replies = result.stdout.trim().split(/\r?\n/).map(line => JSON.parse(line));
  assert.equal(replies[1].error.code, -32602);
  assert.equal(replies[2].result.isError, true);
  assert.match(result.stderr, /SIMULATED_REPLAY_INVALID_CALL/);
});

test('fixture MCP adapter stops after a tool call before initialization completes', () => {
  for (const afterInitialize of [false, true]) {
    const server = createSimulatedReplayMcp(cassette());
    if (afterInitialize) {
      const response = server.handle(request(1, 'initialize', {
        protocolVersion: PROTOCOL_VERSION, capabilities: {}, clientInfo: { name: 'test', version: '1' }
      }));
      assert.equal(response.result.protocolVersion, PROTOCOL_VERSION);
    }
    const early = server.handle(request(2, 'tools/call', { name: 'fixture.issue.lookup', arguments: { issueId: '42' } }));
    assert.equal(early.error.code, -32002);
    assert.equal(server.stopped, true);
    assert.equal(server.position, 0);
    if (afterInitialize) assert.equal(server.handle({ jsonrpc: '2.0', method: 'notifications/initialized' }), null);
    else initialize(server);
    const later = server.handle(request(3, 'tools/call', { name: 'fixture.issue.lookup', arguments: { issueId: '42' } }));
    assert.equal(later.result.isError, true);
    assert.equal(server.position, 0);
    assert.throws(() => server.finish(), { code: 'SIMULATED_REPLAY_INVALID_CALL' });
  }

  const messages = [
    request(1, 'initialize', { protocolVersion: PROTOCOL_VERSION, capabilities: {}, clientInfo: { name: 'wire-test', version: '1' } }),
    request(2, 'tools/call', { name: 'fixture.issue.lookup', arguments: { issueId: '42' } }),
    { jsonrpc: '2.0', method: 'notifications/initialized' },
    request(3, 'tools/call', { name: 'fixture.issue.lookup', arguments: { issueId: '42' } })
  ].map(message => JSON.stringify(message)).join('\n') + '\n';
  const result = runWire(messages);
  assert.equal(result.status, 1);
  const replies = result.stdout.trim().split(/\r?\n/).map(line => JSON.parse(line));
  assert.equal(replies[1].error.code, -32002);
  assert.equal(replies[2].result.isError, true);
  assert.doesNotMatch(result.stderr, /"kind":"injected-fixture"/);
  assert.match(result.stderr, /SIMULATED_REPLAY_INVALID_CALL/);
});

test('fixture MCP adapter stops after a tool call with no or invalid request id', () => {
  for (const invalidCall of [
    { jsonrpc: '2.0', method: 'tools/call', params: { name: 'fixture.issue.lookup', arguments: { issueId: '42' } } },
    request(null, 'tools/call', { name: 'fixture.issue.lookup', arguments: { issueId: '42' } })
  ]) {
    const server = createSimulatedReplayMcp(cassette());
    initialize(server);
    const response = server.handle(invalidCall);
    if (Object.hasOwn(invalidCall, 'id')) assert.equal(response.error.code, -32600);
    else assert.equal(response, null);
    assert.equal(server.position, 0);
    assert.equal(server.stopped, true);
    assert.equal(server.handle(request(3, 'tools/call', { name: 'fixture.issue.lookup', arguments: { issueId: '42' } })).result.isError, true);
    assert.throws(() => server.finish(), { code: 'SIMULATED_REPLAY_INVALID_CALL' });
  }

  const messages = [
    request(1, 'initialize', { protocolVersion: PROTOCOL_VERSION, capabilities: {}, clientInfo: { name: 'wire-test', version: '1' } }),
    { jsonrpc: '2.0', method: 'notifications/initialized' },
    { jsonrpc: '2.0', method: 'tools/call', params: { name: 'fixture.issue.lookup', arguments: { issueId: '42' } } },
    request(2, 'tools/call', { name: 'fixture.issue.lookup', arguments: { issueId: '42' } })
  ].map(message => JSON.stringify(message)).join('\n') + '\n';
  const result = runWire(messages);
  assert.equal(result.status, 1);
  const replies = result.stdout.trim().split(/\r?\n/).map(line => JSON.parse(line));
  assert.equal(replies.length, 2);
  assert.equal(replies[1].result.isError, true);
  assert.match(result.stderr, /SIMULATED_REPLAY_INVALID_CALL/);
});

test('fixture MCP adapter stops when an unsupported batch could hide a tool call', () => {
  const server = createSimulatedReplayMcp(cassette());
  initialize(server);
  const batch = [request(2, 'tools/call', { name: 'fixture.issue.lookup', arguments: { issueId: '42' } })];
  assert.equal(server.handle(batch).error.code, -32600);
  assert.equal(server.stopped, true);
  assert.equal(server.position, 0);
  assert.equal(server.handle(batch).error.code, -32600);
  assert.equal(server.handle(request(3, 'tools/call', { name: 'fixture.issue.lookup', arguments: { issueId: '42' } })).result.isError, true);
  assert.throws(() => server.finish(), { code: 'SIMULATED_REPLAY_INVALID_CALL' });

  const messages = [
    request(1, 'initialize', { protocolVersion: PROTOCOL_VERSION, capabilities: {}, clientInfo: { name: 'wire-test', version: '1' } }),
    { jsonrpc: '2.0', method: 'notifications/initialized' },
    batch,
    request(3, 'tools/call', { name: 'fixture.issue.lookup', arguments: { issueId: '42' } })
  ].map(message => JSON.stringify(message)).join('\n') + '\n';
  const result = runWire(messages);
  assert.equal(result.status, 1);
  const replies = result.stdout.trim().split(/\r?\n/).map(line => JSON.parse(line));
  assert.equal(replies[1].error.code, -32600);
  assert.equal(replies[2].result.isError, true);
  assert.doesNotMatch(result.stderr, /"kind":"injected-fixture"/);
  assert.match(result.stderr, /SIMULATED_REPLAY_INVALID_CALL/);
});

test('stdio server stops after a malformed frame before a later valid tool call', () => {
  const prefix = [
    request(1, 'initialize', { protocolVersion: PROTOCOL_VERSION, capabilities: {}, clientInfo: { name: 'wire-test', version: '1' } }),
    { jsonrpc: '2.0', method: 'notifications/initialized' }
  ].map(message => JSON.stringify(message)).join('\n') + '\n';
  const laterCall = JSON.stringify(request(2, 'tools/call', { name: 'fixture.issue.lookup', arguments: { issueId: '42' } })) + '\n';
  for (const malformed of [Buffer.from('{bad json'), Buffer.from([0xff])]) {
    const messages = Buffer.concat([Buffer.from(prefix), malformed, Buffer.from('\n' + laterCall)]);
    const result = runWire(messages);
    assert.equal(result.status, 1);
    const replies = result.stdout.trim().split(/\r?\n/).map(line => JSON.parse(line));
    assert.equal(replies.length, 2);
    assert.equal(replies[0].result.serverInfo.name, 'chronicle-simulated-replay');
    assert.equal(replies[1].error.code, -32700);
    assert.match(result.stderr, /MCP message could not be parsed; replay stopped/);
    assert.doesNotMatch(result.stderr, /Chronicle replay evidence/);
  }
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

test('stdio server exits with a failure when input closes before end', async () => {
  const input = new PassThrough();
  const output = new Writable({ write(chunk, encoding, callback) { callback(); } });
  const errorOutput = new Writable({ write(chunk, encoding, callback) { callback(); } });
  const result = runStdioReplay({ input, output, errorOutput, cassette: cassette() });
  input.write(JSON.stringify(request(1, 'ping')) + '\n');
  input.destroy();
  assert.equal(await result, 1);
});
