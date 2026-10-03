'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { Chronicle, git, hash, safePath } = require('../src/engine');
const { recordHook } = require('../src/hook');
const { spawnSync } = require('node:child_process');
const { spawn } = require('node:child_process');
const { once } = require('node:events');

function fixture(t, content = 'one\ntwo\nthree\n') {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'chronicle-test-'));
  const root = path.join(base, 'repo'); fs.mkdirSync(root);
  git(root, ['init']); git(root, ['config', 'user.name', 'Test']); git(root, ['config', 'user.email', 'test@example.invalid']); git(root, ['config', 'core.autocrlf', 'false']);
  fs.writeFileSync(path.join(root, 'README.md'), content);
  git(root, ['add', '.']); git(root, ['commit', '-m', 'Baseline']);
  const engine = new Chronicle(root, { storage: path.join(base, 'history') });
  t.after(() => fs.rmSync(base, { recursive: true, force: true }));
  return { root, engine, file: path.join(root, 'README.md') };
}

test('fixture run evidence binds only a complete run to a fresh matching output', t => {
  const { engine, file } = fixture(t);
  const cassette = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'fixtures', 'simulated-tools', 'issue-tracker.json'), 'utf8'));
  const before = engine.capture('Before');
  fs.writeFileSync(file, 'one\nchanged\nthree\n');
  const after = engine.capture('After');
  const selected = [engine.compare(before.id, after.id).changes[0].hunks[0].id];
  const run = engine.beginFixtureRun(cassette, before.id);
  const server = run.server;
  server.handle({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {
    protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'fixture-test', version: '1' }
  } });
  server.handle({ jsonrpc: '2.0', method: 'notifications/initialized' });
  server.handle({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'fixture.issue.lookup', arguments: { issueId: '42' } } });
  server.handle({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'fixture.issue.search', arguments: { query: 'README headings', limit: 2 } } });
  assert.deepEqual(run.finish(), { status: 'complete', consumedCalls: 2 });
  const op = run.createBranch(after.id, selected, 'chronicle/fixture-bound');
  const fileName = path.join(engine.store, 'fixture-runs', run.id + '.json');
  const saved = JSON.parse(fs.readFileSync(fileName, 'utf8'));
  assert.deepEqual(saved.events.map(event => event.sequence), [1, 2]);
  assert.ok(saved.events.every(event => event.runId === run.id && event.cassetteHash === saved.cassetteHash));
  const replacement = fileName + '.' + crypto.randomUUID() + '.tmp';
  fs.writeFileSync(replacement, JSON.stringify({ ...saved, outcome: null }));
  assert.throws(() => engine.bindFixtureRun(run.id, op.id), /interrupted journal replacement/);
  assert.equal(fs.existsSync(replacement), true);
  fs.unlinkSync(replacement);
  assert.equal(engine.bindFixtureRun(run.id, op.id).operationId, op.id);
  assert.throws(() => engine.bindFixtureRun(run.id, op.id), /already bound/);

  const duplicate = engine.beginFixtureRun(cassette, before.id);
  const second = duplicate.server;
  second.handle({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {
    protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'fixture-test', version: '1' }
  } });
  second.handle({ jsonrpc: '2.0', method: 'notifications/initialized' });
  second.handle({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'fixture.issue.lookup', arguments: { issueId: '42' } } });
  second.handle({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'fixture.issue.search', arguments: { query: 'README headings', limit: 2 } } });
  duplicate.finish();
  assert.throws(() => engine.bindFixtureRun(duplicate.id, op.id), /incomplete/);

  const stale = duplicate.createBranch(after.id, selected, 'chronicle/fixture-stale');
  fs.writeFileSync(path.join(stale.target, 'README.md'), 'later edit\n');
  assert.throws(() => engine.bindFixtureRun(duplicate.id, stale.id), /stale/);
  const otherSource = engine.capture('Different source');
  fs.writeFileSync(file, 'one\nother change\nthree\n');
  const otherResult = engine.capture('Different result');
  const otherSelection = [engine.compare(otherSource.id, otherResult.id).changes[0].hunks[0].id];
  const unrelated = engine.createBranch(otherSource.id, otherResult.id, otherSelection, 'chronicle/fixture-other-source');
  assert.throws(() => engine.bindFixtureRun(duplicate.id, unrelated.id), /incomplete/);
  assert.equal(JSON.parse(fs.readFileSync(path.join(engine.store, 'fixture-runs', duplicate.id + '.json'), 'utf8')).binding, null);
});

test('rejected or incomplete fixture runs remain unbound', t => {
  const { engine } = fixture(t);
  const cassette = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'fixtures', 'simulated-tools', 'issue-tracker.json'), 'utf8'));
  const before = engine.capture('Before');
  const run = engine.beginFixtureRun(cassette, before.id);
  assert.deepEqual(run.finish(), { status: 'failed', code: 'MCP_NOT_INITIALIZED' });
  assert.throws(() => engine.bindFixtureRun(run.id, crypto.randomUUID()), /incomplete/);
  const rejected = engine.beginFixtureRun(cassette, before.id);
  rejected.server.handle({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {
    protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'fixture-test', version: '1' }
  } });
  rejected.server.handle({ jsonrpc: '2.0', method: 'notifications/initialized' });
  rejected.server.handle({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'fixture.issue.lookup', arguments: { issueId: 'wrong' } } });
  assert.deepEqual(rejected.finish(), { status: 'failed', code: 'SIMULATED_REPLAY_UNMATCHED' });
  const record = JSON.parse(fs.readFileSync(path.join(engine.store, 'fixture-runs', rejected.id + '.json'), 'utf8'));
  assert.deepEqual(record.events.map(event => event.kind), ['rejected-fixture']);
  assert.throws(() => engine.bindFixtureRun(rejected.id, crypto.randomUUID()), /rejected/);
});

test('fixture subprocess exit and evidence gate branch binding', async t => {
  const { engine, file } = fixture(t);
  const cassette = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'fixtures', 'simulated-tools', 'issue-tracker.json'), 'utf8'));
  const before = engine.capture('Before');
  fs.writeFileSync(file, 'one\nchanged\nthree\n');
  const after = engine.capture('After');
  const selected = [engine.compare(before.id, after.id).changes[0].hunks[0].id];
  const initialize = { jsonrpc: '2.0', id: 1, method: 'initialize', params: {
    protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'fixture-test', version: '1' }
  } };
  const ready = { jsonrpc: '2.0', method: 'notifications/initialized' };
  const lookup = { jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'fixture.issue.lookup', arguments: { issueId: '42' } } };
  const search = { jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'fixture.issue.search', arguments: { query: 'README headings', limit: 2 } } };
  const run = await engine.runFixtureSubprocess(cassette, before.id, [initialize, ready, lookup, search]);
  assert.deepEqual(run.outcome, { status: 'complete', consumedCalls: 2 });
  assert.equal(run.responses.filter(response => response.result?.isError === false).length, 2);
  const saved = JSON.parse(fs.readFileSync(path.join(engine.store, 'fixture-runs', run.id + '.json'), 'utf8'));
  assert.deepEqual(saved.processExit, { code: 0, signal: null });
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(engine.store, 'fixture-runs', run.id + '.launch.json'), 'utf8')),
    { runId: run.id, pid: saved.childPid });
  assert.deepEqual(saved.events.map(event => event.sequence), [1, 2]);
  const operation = run.createBranch(after.id, selected, 'chronicle/process-bound');
  const cassetteFile = path.join(engine.store, 'fixture-runs', run.id + '.cassette.json');
  const cassetteBytes = fs.readFileSync(cassetteFile);
  fs.writeFileSync(cassetteFile, '{}');
  assert.throws(() => engine.bindFixtureRun(run.id, operation.id), /cassette differs/);
  fs.unlinkSync(cassetteFile);
  assert.throws(() => engine.bindFixtureRun(run.id, operation.id), /cassette is unavailable/);
  fs.mkdirSync(cassetteFile);
  assert.throws(() => engine.bindFixtureRun(run.id, operation.id), /cassette is unavailable/);
  fs.rmdirSync(cassetteFile);
  fs.writeFileSync(cassetteFile, ' '.repeat(1024 * 1024 + 1));
  assert.throws(() => engine.bindFixtureRun(run.id, operation.id), /cassette is unavailable/);
  fs.unlinkSync(cassetteFile);
  const outsideCassette = path.join(path.dirname(engine.store), 'outside-cassette.json');
  fs.writeFileSync(outsideCassette, cassetteBytes);
  try {
    fs.symlinkSync(outsideCassette, cassetteFile, 'file');
    assert.throws(() => engine.bindFixtureRun(run.id, operation.id), /cassette is unavailable/);
    fs.unlinkSync(cassetteFile);
  } catch (error) {
    if (error.code !== 'EPERM' && error.code !== 'EACCES' && error.code !== 'ENOTSUP') throw error;
  }
  assert.deepEqual(fs.readFileSync(outsideCassette), cassetteBytes);
  fs.writeFileSync(cassetteFile, cassetteBytes);
  assert.equal(engine.bindFixtureRun(run.id, operation.id).operationId, operation.id);

  const rejected = await engine.runFixtureSubprocess(cassette, before.id, [initialize, ready, { ...lookup, params: {
    name: 'fixture.issue.lookup', arguments: { issueId: 'wrong' }
  } }]);
  assert.equal(rejected.outcome.status, 'failed');
  assert.throws(() => rejected.createBranch(after.id, selected, 'chronicle/process-rejected'), /incomplete/);
  assert.throws(() => engine.bindFixtureRun(rejected.id, operation.id), /incomplete/);
});

test('fixture subprocess recovery fails closed only after both recorded processes are gone', async t => {
  const { engine } = fixture(t);
  const cassette = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'fixtures', 'simulated-tools', 'issue-tracker.json'), 'utf8'));
  const before = engine.capture('Before');
  const run = await engine.runFixtureSubprocess(cassette, before.id, []);
  const file = path.join(engine.store, 'fixture-runs', run.id + '.json');
  const cassetteFile = path.join(engine.store, 'fixture-runs', run.id + '.cassette.json');
  const saved = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.equal(saved.outcome.status, 'failed');
  assert.ok(saved.childPid > 0);
  const cassetteBytes = fs.readFileSync(cassetteFile);
  saved.outcome = null;
  saved.controllerPid = process.pid;
  fs.writeFileSync(file, JSON.stringify(saved));
  assert.deepEqual(engine.recoverFixtureRuns(), [{ id: run.id, assessment: 'pending-inspect' }]);
  assert.equal(JSON.parse(fs.readFileSync(file, 'utf8')).outcome, null);
  saved.controllerPid = saved.childPid;
  fs.writeFileSync(file, JSON.stringify(saved));
  const launchFile = path.join(engine.store, 'fixture-runs', run.id + '.launch.json');
  const launchBytes = fs.readFileSync(launchFile);
  fs.writeFileSync(launchFile, JSON.stringify({ runId: run.id, pid: process.pid }));
  assert.deepEqual(engine.recoverFixtureRuns(), [{ id: run.id, assessment: 'pending-inspect' }]);
  assert.equal(JSON.parse(fs.readFileSync(file, 'utf8')).outcome, null);
  fs.writeFileSync(launchFile, '{');
  assert.deepEqual(engine.recoverFixtureRuns(), [{ id: run.id, assessment: 'pending-inspect' }]);
  fs.writeFileSync(launchFile, ' '.repeat(513));
  assert.deepEqual(engine.recoverFixtureRuns(), [{ id: run.id, assessment: 'pending-inspect' }]);
  fs.unlinkSync(launchFile);
  const outside = path.join(path.dirname(engine.store), 'outside-witness.json');
  fs.writeFileSync(outside, launchBytes);
  try {
    fs.symlinkSync(outside, launchFile, 'file');
    assert.deepEqual(engine.recoverFixtureRuns(), [{ id: run.id, assessment: 'pending-inspect' }]);
    fs.unlinkSync(launchFile);
  } catch (error) {
    if (error.code !== 'EPERM' && error.code !== 'EACCES' && error.code !== 'ENOTSUP') throw error;
  }
  assert.deepEqual(fs.readFileSync(outside), launchBytes);
  fs.mkdirSync(launchFile);
  assert.deepEqual(engine.recoverFixtureRuns(), [{ id: run.id, assessment: 'pending-inspect' }]);
  fs.rmdirSync(launchFile);
  fs.writeFileSync(launchFile, launchBytes);
  assert.deepEqual(engine.recoverFixtureRuns(), [{ id: run.id, assessment: 'interrupted-recorded' }]);
  const recovered = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.deepEqual(recovered.outcome, { status: 'failed', code: 'MCP_PROCESS_INTERRUPTED' });
  assert.deepEqual(recovered.events, saved.events);
  assert.deepEqual(fs.readFileSync(cassetteFile), cassetteBytes);
  assert.throws(() => engine.bindFixtureRun(run.id, crypto.randomUUID()), /incomplete/);
  assert.deepEqual(engine.recoverFixtureRuns(), []);
});

test('fixture recovery distinguishes pre-spawn from uncertain child launch', async t => {
  const { engine } = fixture(t);
  const cassette = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'fixtures', 'simulated-tools', 'issue-tracker.json'), 'utf8'));
  const before = engine.capture('Before');
  const run = await engine.runFixtureSubprocess(cassette, before.id, []);
  const file = path.join(engine.store, 'fixture-runs', run.id + '.json');
  const cassetteFile = path.join(engine.store, 'fixture-runs', run.id + '.cassette.json');
  const launchFile = path.join(engine.store, 'fixture-runs', run.id + '.launch.json');
  const saved = JSON.parse(fs.readFileSync(file, 'utf8'));
  const cassetteBytes = fs.readFileSync(cassetteFile);
  assert.equal(saved.launchPhase, 'child-recorded');
  saved.outcome = null;
  saved.controllerPid = saved.childPid;
  saved.childPid = null;
  saved.launchPhase = 'spawning';
  fs.writeFileSync(file, JSON.stringify(saved));
  const launchBytes = fs.readFileSync(launchFile);
  fs.unlinkSync(launchFile);
  assert.deepEqual(engine.recoverFixtureRuns(), [{ id: run.id, assessment: 'pending-inspect' }]);
  fs.writeFileSync(launchFile, '{');
  assert.deepEqual(engine.recoverFixtureRuns(), [{ id: run.id, assessment: 'pending-inspect' }]);
  fs.writeFileSync(launchFile, launchBytes);
  assert.deepEqual(engine.recoverFixtureRuns(), [{ id: run.id, assessment: 'interrupted-recorded' }]);
  assert.deepEqual(fs.readFileSync(launchFile), launchBytes);
  assert.deepEqual(fs.readFileSync(cassetteFile), cassetteBytes);
  assert.deepEqual(engine.recoverFixtureRuns(), []);

  const second = await engine.runFixtureSubprocess(cassette, before.id, []);
  const secondFile = path.join(engine.store, 'fixture-runs', second.id + '.json');
  const secondLaunch = path.join(engine.store, 'fixture-runs', second.id + '.launch.json');
  const preSpawn = JSON.parse(fs.readFileSync(secondFile, 'utf8'));
  preSpawn.outcome = null;
  preSpawn.controllerPid = preSpawn.childPid;
  preSpawn.childPid = null;
  preSpawn.launchPhase = 'prepared';
  fs.writeFileSync(secondFile, JSON.stringify(preSpawn));
  fs.writeFileSync(secondLaunch, '{');
  assert.deepEqual(engine.recoverFixtureRuns(), [{ id: second.id, assessment: 'pending-inspect' }]);
  fs.unlinkSync(secondLaunch);
  assert.deepEqual(engine.recoverFixtureRuns(), [{ id: second.id, assessment: 'interrupted-recorded' }]);
  assert.deepEqual(JSON.parse(fs.readFileSync(secondFile, 'utf8')).outcome,
    { status: 'failed', code: 'MCP_PROCESS_INTERRUPTED' });
  assert.throws(() => engine.bindFixtureRun(second.id, crypto.randomUUID()), /incomplete/);
  assert.deepEqual(engine.recoverFixtureRuns(), []);
});

test('fixture recovery preserves interrupted journal replacements for inspection', async t => {
  const { engine } = fixture(t);
  const cassette = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'fixtures', 'simulated-tools', 'issue-tracker.json'), 'utf8'));
  const before = engine.capture('Before');
  const run = await engine.runFixtureSubprocess(cassette, before.id, []);
  const folder = path.join(engine.store, 'fixture-runs');
  const file = path.join(folder, run.id + '.json');
  const saved = JSON.parse(fs.readFileSync(file, 'utf8'));
  const cassetteFile = path.join(folder, run.id + '.cassette.json');
  const cassetteBytes = fs.readFileSync(cassetteFile);
  saved.outcome = null;
  saved.controllerPid = saved.childPid;
  fs.writeFileSync(file, JSON.stringify(saved));
  const recordBytes = fs.readFileSync(file);
  const temp = file + '.' + crypto.randomUUID() + '.tmp';
  fs.writeFileSync(temp, JSON.stringify({ ...saved, outcome: { status: 'complete', consumedCalls: 0 } }));
  const tempBytes = fs.readFileSync(temp);
  assert.deepEqual(engine.recoverFixtureRuns(), [{ id: run.id, assessment: 'replacement-inspect' }]);
  assert.deepEqual(fs.readFileSync(file), recordBytes);
  assert.deepEqual(fs.readFileSync(temp), tempBytes);
  assert.deepEqual(fs.readFileSync(cassetteFile), cassetteBytes);
  assert.throws(() => engine.bindFixtureRun(run.id, crypto.randomUUID()), /interrupted journal replacement/);
  assert.deepEqual(engine.recoverFixtureRuns(), [{ id: run.id, assessment: 'replacement-inspect' }]);
});

test('fixture subprocess recovery preserves a real killed controller record', async t => {
  const { root, engine } = fixture(t);
  const before = engine.capture('Before');
  const cassettePath = path.join(__dirname, '..', 'fixtures', 'simulated-tools', 'issue-tracker.json');
  const controllerSource = `
    const fs = require('node:fs');
    const { Chronicle } = require(${JSON.stringify(path.join(__dirname, '..', 'src', 'engine.js'))});
    const [root, storage, checkpoint, cassettePath] = process.argv.slice(1);
    const cassette = JSON.parse(fs.readFileSync(cassettePath, 'utf8'));
    new Chronicle(root, { storage }).runFixtureSubprocess(cassette, checkpoint, []);
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 30000);
  `;
  const controller = spawn(process.execPath, ['-e', controllerSource, root, path.dirname(engine.store), before.id, cassettePath],
    { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] });
  let controllerError = '';
  controller.stderr.on('data', chunk => { controllerError += chunk.toString('utf8'); });
  let childPid;
  t.after(() => {
    if (controller.exitCode === null) controller.kill();
    if (childPid) { try { process.kill(childPid); } catch (error) { if (error.code !== 'ESRCH') throw error; } }
  });
  await once(controller, 'spawn');
  const folder = path.join(engine.store, 'fixture-runs');
  const deadline = Date.now() + 10000;
  let saved, file;
  while (Date.now() < deadline) {
    const names = fs.readdirSync(folder).filter(name => /^[a-f0-9-]{36}\.json$/.test(name));
    if (names.length === 1) {
      file = path.join(folder, names[0]);
      try { saved = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { /* atomic replacement in progress */ }
      if (saved?.childPid > 0) break;
    }
    await new Promise(resolve => setTimeout(resolve, 20));
  }
  assert.ok(saved?.childPid > 0, `controller should persist its child PID before interruption: ${controllerError}`);
  childPid = saved.childPid;
  assert.equal(saved.outcome, null);
  assert.equal(saved.controllerPid, controller.pid);
  assert.deepEqual(engine.recoverFixtureRuns(), [{ id: saved.id, assessment: 'pending-inspect' }]);
  const cassetteBytes = fs.readFileSync(path.join(folder, saved.id + '.cassette.json'));
  const exited = once(controller, 'exit');
  assert.equal(controller.kill(), true);
  await exited;
  const deadBy = Date.now() + 5000;
  let childDead = false;
  while (Date.now() < deadBy) {
    try { process.kill(childPid, 0); }
    catch (error) { if (error.code === 'ESRCH') { childDead = true; break; } throw error; }
    await new Promise(resolve => setTimeout(resolve, 20));
  }
  assert.equal(childDead, true, 'the fixture child must exit before recovery');
  childPid = null;
  assert.deepEqual(engine.recoverFixtureRuns(), [{ id: saved.id, assessment: 'interrupted-recorded' }]);
  const recovered = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.deepEqual(recovered.outcome, { status: 'failed', code: 'MCP_PROCESS_INTERRUPTED' });
  assert.deepEqual(recovered.events, saved.events);
  assert.deepEqual(fs.readFileSync(path.join(folder, saved.id + '.cassette.json')), cassetteBytes);
  assert.deepEqual(engine.recoverFixtureRuns(), []);
});

test('keep 40 of 80 edits, dirty baseline and staged index remain intact', t => {
  const original = Array.from({ length: 120 }, (_, i) => `line ${i}\n`);
  const { root, engine, file } = fixture(t, original.join(''));
  fs.writeFileSync(path.join(root, 'manual.txt'), 'pre-existing untracked\n');
  fs.writeFileSync(path.join(root, 'staged.txt'), 'staged manual\n'); git(root, ['add', 'staged.txt']);
  original[60] = 'pre-existing unstaged\n'; fs.writeFileSync(file, original.join(''));
  const before = engine.capture('Before');
  const changed = [...original];
  for (let i = 0; i < 40; i++) changed[i] = `wanted ${i}\n`;
  for (let i = 80; i < 120; i++) changed[i] = `unwanted ${i}\n`;
  fs.writeFileSync(file, changed.join(''));
  const indexBefore = hash(fs.readFileSync(path.join(root, '.git', 'index')));
  const headBefore = git(root, ['rev-parse', 'HEAD']);
  const after = engine.capture('After');
  const diff = engine.compare(before.id, after.id);
  assert.equal(diff.changes[0].hunks.length, 2);
  const selection = [diff.changes[0].hunks[0].id];
  const expected = [...original]; for (let i = 0; i < 40; i++) expected[i] = `wanted ${i}\n`;
  assert.equal(engine.preview(before.id, after.id, selection).files[0].content, expected.join(''));
  const op = engine.createBranch(before.id, after.id, selection, 'chronicle/keep-40');
  assert.equal(fs.readFileSync(path.join(op.target, 'README.md'), 'utf8'), expected.join(''));
  assert.equal(fs.readFileSync(path.join(op.target, 'manual.txt'), 'utf8'), 'pre-existing untracked\n');
  assert.equal(fs.readFileSync(path.join(op.target, 'staged.txt'), 'utf8'), 'staged manual\n');
  assert.equal(fs.readFileSync(file, 'utf8'), changed.join(''));
  assert.equal(hash(fs.readFileSync(path.join(root, '.git', 'index'))), indexBefore);
  assert.equal(git(root, ['rev-parse', 'HEAD']), headBefore);
  assert.equal(op.modelRequests, 0);
  assert.equal(engine.operations()[0].state, 'completed');
  assert.equal(engine.reconcileOperations()[0].assessment, 'completed');
  assert.equal(engine.reconcileOperations()[0].dirty, true); // The intended selection is uncommitted by design.
  assert.equal(engine.reconcileOperations()[0].modifiedSinceCompletion, false);
});

test('branch manifests compare saved outputs and label unmeasured checks and cost as unavailable', t => {
  const { root, engine } = fixture(t, 'base\n');
  fs.writeFileSync(path.join(root, 'a.txt'), 'a0\n');
  fs.writeFileSync(path.join(root, 'b.txt'), 'b0\n');
  fs.writeFileSync(path.join(root, 'common.txt'), 'same\n');
  fs.writeFileSync(path.join(root, 'deleted.txt'), 'keep unless selected\n');
  git(root, ['add', '.']); git(root, ['commit', '-m', 'Add fixture files']);
  const before = engine.capture('Before');
  fs.writeFileSync(path.join(root, 'a.txt'), 'a1\n');
  fs.writeFileSync(path.join(root, 'b.txt'), 'b1\n');
  fs.writeFileSync(path.join(root, 'added.txt'), 'new file\n');
  fs.unlinkSync(path.join(root, 'deleted.txt'));
  const after = engine.capture('After');
  const changes = engine.compare(before.id, after.id).changes;
  const aId = changes.find(change => change.path === 'a.txt').hunks[0].id;
  const bId = changes.find(change => change.path === 'b.txt').hunks[0].id;
  const addedId = changes.find(change => change.path === 'added.txt').hunks[0].id;
  const deletedId = changes.find(change => change.path === 'deleted.txt').hunks[0].id;
  const a = engine.createBranch(before.id, after.id, [aId, addedId, deletedId], 'chronicle/manifest-a');
  const b = engine.createBranch(before.id, after.id, [bId], 'chronicle/manifest-b');
  assert.equal(a.manifest.schema, 1);
  assert.deepEqual(a.manifest.checkpoints, { from: before.id, to: after.id });
  assert.equal(a.manifest.baselineCommit, before.head);
  assert.deepEqual(a.manifest.selectedChangeIds, [aId, addedId, deletedId]);
  assert.equal(a.manifest.host.source, 'manual');
  assert.deepEqual(a.manifest.checks, []);
  assert.equal(a.manifest.reportedCost, null);
  assert.equal(a.manifest.outputFiles.find(file => file.path === 'a.txt').hash, hash(Buffer.from('a1\n')));
  const pass = engine.recordCheck(a.id, 'npm test', 0);
  const fail = engine.recordCheck(a.id, 'lint', 2);
  assert.deepEqual([pass.outcome, fail.outcome], ['reported-pass', 'reported-fail']);
  assert.equal(pass.source, 'user-reported');
  assert.throws(() => engine.recordCheck(a.id, 'invalid', 256), /integer from 0 to 255/);
  assert.throws(() => engine.recordCheck(a.id, 'bad\nlabel', 0), /one line/);
  const comparison = engine.compareOperations(a.id, b.id);
  assert.deepEqual(comparison.files.map(file => [file.path, file.status]), [
    ['a.txt', 'changed'], ['added.txt', 'deleted'], ['b.txt', 'changed'], ['common.txt', 'identical'], ['deleted.txt', 'added'], ['README.md', 'identical']
  ]);
  assert.equal(comparison.first.manifest.reportedCost, null);
  assert.throws(() => engine.compareOperations(a.id, a.id), /two different operations/);
  assert.equal(comparison.modelRequests, 0);
  const cli = spawnSync(process.execPath, [path.join(__dirname, '..', 'src', 'cli.js'), 'compare-operations', a.id, b.id], {
    cwd: root, encoding: 'utf8', env: { ...process.env, CHRONICLE_HOME: path.dirname(engine.store) }
  });
  assert.equal(cli.status, 0, cli.stderr);
  assert.deepEqual(JSON.parse(cli.stdout).files.map(file => [file.path, file.status]), comparison.files.map(file => [file.path, file.status]));
  const recordCli = spawnSync(process.execPath, [path.join(__dirname, '..', 'src', 'cli.js'), 'record-check', b.id, '7', 'smoke check'], {
    cwd: root, encoding: 'utf8', env: { ...process.env, CHRONICLE_HOME: path.dirname(engine.store) }
  });
  assert.equal(recordCli.status, 0, recordCli.stderr);
  assert.deepEqual([JSON.parse(recordCli.stdout).outcome, JSON.parse(recordCli.stdout).source], ['reported-fail', 'user-reported']);
});

test('selection ignores user diff colors and blank-context formatting', t => {
  const { root, engine, file } = fixture(t, 'one\n\nthree\n\nfive\n');
  const before = engine.capture();
  fs.writeFileSync(file, 'wanted\n\nthree\n\nunwanted\n');
  const after = engine.capture();
  const configHome = path.join(engine.store, 'test-git-home'); fs.mkdirSync(configHome);
  fs.writeFileSync(path.join(configHome, '.gitconfig'), '[color]\n ui = always\n[diff]\n suppressBlankEmpty = true\n');
  const script = `
    const assert = require('node:assert/strict');
    const { Chronicle, git } = require(${JSON.stringify(require.resolve('../src/engine'))});
    const engine = new Chronicle(${JSON.stringify(root)}, { storage: ${JSON.stringify(path.dirname(engine.store))} });
    assert.equal(git(engine.root, ['config', '--get', 'color.ui']).trim(), 'always');
    const diff = engine.compare(${JSON.stringify(before.id)}, ${JSON.stringify(after.id)});
    const groups = diff.changes[0].hunks[0].groups;
    assert.equal(groups.length, 2);
    assert.equal(groups[1].oldStart, 4);
    const selected = [groups[0].id];
    const preview = engine.preview(diff.from, diff.to, selected);
    assert.equal(preview.files[0].content, 'wanted\\n\\nthree\\n\\nfive\\n');
    assert.equal(engine.preview(diff.from, diff.to, [groups[1].id]).files[0].content, 'one\\n\\nthree\\n\\nunwanted\\n');
    const op = engine.createBranch(diff.from, diff.to, selected, 'chronicle/config-proof');
    assert.equal(require('node:fs').readFileSync(require('node:path').join(op.target, 'README.md'), 'utf8'), preview.files[0].content);
  `;
  const result = spawnSync(process.execPath, ['-e', script], { encoding: 'utf8', env: { ...process.env, HOME: configHome, XDG_CONFIG_HOME: configHome }, windowsHide: true });
  assert.equal(result.status, 0, result.stderr);
});

test('CRLF, Unicode, BOM, and missing final newline survive selected output', t => {
  const { engine, file } = fixture(t, '\ufeffhello\r\n世界\r\nlast');
  const a = engine.capture(); fs.writeFileSync(file, '\ufeffhello\r\nchanged 世界\r\nlast'); const b = engine.capture();
  const diff = engine.compare(a.id, b.id);
  const group = diff.changes[0].hunks[0].groups[0];
  const preview = engine.preview(a.id, b.id, [group.id]);
  assert.equal(preview.files[0].content, '\ufeffhello\r\nchanged 世界\r\nlast');
});

test('change groups split nearby edits and keep each replacement linked', t => {
  const original = Array.from({ length: 20 }, (_, i) => 'line ' + i + '\r\n');
  const { engine, file } = fixture(t, original.join(''));
  const before = engine.capture(), changed = [...original];
  changed[2] = 'wanted 2a\r\n'; changed[3] = 'wanted 2b\r\n';
  for (const i of [6, 10]) changed[i] = 'wanted ' + i + '\r\n';
  fs.writeFileSync(file, changed.join(''));
  const after = engine.capture(), diff = engine.compare(before.id, after.id);
  assert.equal(diff.changes[0].hunks.length, 1);
  const hunk = diff.changes[0].hunks[0];
  assert.equal(hunk.groups.length, 3);
  assert.equal(hunk.groups[0].oldCount, 2); assert.equal(hunk.groups[0].newCount, 2);
  assert.equal(hunk.groups[1].oldCount, 1); assert.equal(hunk.groups[1].newCount, 1);
  assert.match(hunk.groups[0].patch, /-line 2[\s\S]*-line 3[\s\S]*\+wanted 2a[\s\S]*\+wanted 2b/);
  assert.match(hunk.groups[1].patch, /-line 6\r?\n\+wanted 6/);
  const selected = [hunk.groups[0].id, hunk.groups[2].id];
  const expected = [...original]; expected[2] = changed[2]; expected[3] = changed[3]; expected[10] = changed[10];
  assert.equal(engine.preview(before.id, after.id, selected).files[0].content, expected.join(''));
  assert.equal(engine.preview(before.id, after.id, [hunk.id]).files[0].content, changed.join(''));
  assert.equal(engine.preview(before.id, after.id, [hunk.id, hunk.groups[1].id]).files[0].content, changed.join(''));
  const operation = engine.createBranch(before.id, after.id, selected, 'chronicle/group-selection');
  assert.equal(fs.readFileSync(path.join(operation.target, 'README.md'), 'utf8'), expected.join(''));
  changed[15] = 'later pair\r\n'; fs.writeFileSync(file, changed.join(''));
  const later = engine.capture();
  assert.throws(() => engine.preview(before.id, later.id, [hunk.groups[0].id]), /Stale or invalid/);
});

test('change groups preserve standalone insertions and deletions within one hunk', t => {
  const original = Array.from({ length: 20 }, (_, i) => 'line ' + i + '\n');
  const { engine, file } = fixture(t, original.join(''));
  const before = engine.capture(), changed = original.filter((_, index) => index !== 2);
  changed.splice(5, 0, 'inserted\n'); fs.writeFileSync(file, changed.join(''));
  const after = engine.capture(), hunk = engine.compare(before.id, after.id).changes[0].hunks[0];
  assert.equal(hunk.groups.length, 2);
  const deletion = hunk.groups.find(group => group.oldCount === 1 && group.newCount === 0);
  const insertion = hunk.groups.find(group => group.oldCount === 0 && group.newCount === 1);
  assert.ok(deletion); assert.ok(insertion);
  const withoutDeleted = original.filter((_, index) => index !== 2);
  const withInserted = [...original.slice(0, 6), 'inserted\n', ...original.slice(6)];
  assert.equal(engine.preview(before.id, after.id, [deletion.id]).files[0].content, withoutDeleted.join(''));
  assert.equal(engine.preview(before.id, after.id, [insertion.id]).files[0].content, withInserted.join(''));
});

test('whole-file additions, deletions, and baseline deletions are restored', t => {
  const { root, engine, file } = fixture(t);
  fs.writeFileSync(path.join(root, 'deleted-before.txt'), 'old'); git(root, ['add', '.']); git(root, ['commit', '-m', 'Extra baseline']);
  fs.unlinkSync(path.join(root, 'deleted-before.txt'));
  const a = engine.capture(); fs.unlinkSync(file); fs.writeFileSync(path.join(root, 'new.txt'), 'new\n'); const b = engine.capture();
  const ids = engine.compare(a.id, b.id).changes.flatMap(f => f.hunks.map(h => h.id));
  const op = engine.createBranch(a.id, b.id, ids, 'chronicle/add-delete');
  assert.equal(fs.existsSync(path.join(op.target, 'README.md')), false);
  assert.equal(fs.existsSync(path.join(op.target, 'deleted-before.txt')), false);
  assert.equal(fs.readFileSync(path.join(op.target, 'new.txt'), 'utf8'), 'new\n');
  assert.equal(engine.reconcileOperations().find(item => item.id === op.id).modifiedSinceCompletion, false);
  const undoable = engine.createBranch(a.id, b.id, ids, 'chronicle/add-delete-undo');
  engine.undoOperation(undoable.id);
  assert.equal(fs.readFileSync(path.join(undoable.target, 'README.md'), 'utf8'), 'one\ntwo\nthree\n');
  assert.equal(fs.existsSync(path.join(undoable.target, 'new.txt')), false);
  fs.writeFileSync(path.join(op.target, 'README.md'), 'restored later\n');
  assert.equal(engine.reconcileOperations().find(item => item.id === op.id).assessment, 'completed-worktree-modified');
});

test('guarded undo restores only selected output paths and leaves source and unrelated files alone', t => {
  const { root, engine, file } = fixture(t, 'one\ntwo\nthree\n');
  fs.writeFileSync(path.join(root, 'other.txt'), 'unrelated\n');
  const before = engine.capture(); fs.writeFileSync(file, 'one\nchanged\nthree\n'); const after = engine.capture();
  const ids = engine.compare(before.id, after.id).changes.flatMap(change => change.hunks.map(hunk => hunk.id));
  const op = engine.createBranch(before.id, after.id, ids, 'chronicle/undo-clean');
  fs.writeFileSync(path.join(op.target, 'unrelated-output.txt'), 'keep me\n');
  const result = engine.undoOperation(op.id);
  assert.equal(result.state, 'undone'); assert.deepEqual(result.restoredPaths, ['README.md']);
  assert.equal(fs.readFileSync(path.join(op.target, 'README.md'), 'utf8'), 'one\ntwo\nthree\n');
  assert.equal(fs.readFileSync(path.join(op.target, 'unrelated-output.txt'), 'utf8'), 'keep me\n');
  assert.equal(fs.readFileSync(file, 'utf8'), 'one\nchanged\nthree\n');
  assert.equal(engine.reconcileOperations().find(item => item.id === op.id).assessment, 'operation-undone');
});

test('guarded undo refuses later edits, staged selected paths, and committed output', t => {
  for (const scenario of ['edited', 'staged', 'committed']) {
    const { root, engine, file } = fixture(t);
    const before = engine.capture(); fs.writeFileSync(file, 'changed\n'); const after = engine.capture();
    const ids = engine.compare(before.id, after.id).changes.flatMap(change => change.hunks.map(hunk => hunk.id));
    const op = engine.createBranch(before.id, after.id, ids, 'chronicle/undo-' + scenario);
    if (scenario === 'edited') fs.writeFileSync(path.join(op.target, 'README.md'), 'developer edit\n');
    if (scenario === 'staged') git(op.target, ['add', 'README.md']);
    if (scenario === 'committed') { git(op.target, ['add', 'README.md']); git(op.target, ['-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', 'commit', '-m', 'keep result']); }
    assert.throws(() => engine.undoOperation(op.id), scenario === 'edited' ? /changed after Chronicle/ : scenario === 'staged' ? /staged changes/ : /new commits/);
    assert.equal(fs.existsSync(path.join(engine.store, 'operations', op.id + '.json')), true);
  }
});

test('guarded undo resumes a partially restored multi-file operation', t => {
  const { root, engine, file } = fixture(t);
  fs.writeFileSync(path.join(root, 'second.txt'), 'old\n');
  const before = engine.capture(); fs.writeFileSync(file, 'changed\n'); fs.writeFileSync(path.join(root, 'second.txt'), 'new\n'); const after = engine.capture();
  const ids = engine.compare(before.id, after.id).changes.flatMap(change => change.hunks.map(hunk => hunk.id));
  const op = engine.createBranch(before.id, after.id, ids, 'chronicle/undo-retry');
  const journal = path.join(engine.store, 'operations', op.id + '.json');
  const record = JSON.parse(fs.readFileSync(journal, 'utf8')); record.state = 'undoing'; fs.writeFileSync(journal, JSON.stringify(record));
  fs.writeFileSync(path.join(op.target, 'README.md'), 'one\ntwo\nthree\n'); // Already restored before a simulated interruption.
  const result = engine.undoOperation(op.id);
  assert.equal(result.state, 'undone');
  assert.equal(fs.readFileSync(path.join(op.target, 'second.txt'), 'utf8'), 'old\n');
});

test('exclusions are reported and incomplete output is rejected', t => {
  const { root, engine, file } = fixture(t);
  fs.writeFileSync(path.join(root, '.env'), 'SECRET=value'); fs.writeFileSync(path.join(root, 'binary.dat'), Buffer.from([0, 1, 2]));
  const a = engine.capture(); fs.writeFileSync(file, 'changed\n'); const b = engine.capture();
  assert.equal(a.excluded.length, 2);
  assert.equal(Object.hasOwn(a.files, '.env'), false);
  const ids = engine.compare(a.id, b.id).changes.flatMap(f => f.hunks.map(h => h.id));
  assert.throws(() => engine.createBranch(a.id, b.id, ids, 'chronicle/incomplete'), /excluded files/);
});

test('invalid selections, branch names, and escaping paths are rejected', t => {
  const { root, engine, file } = fixture(t); const a = engine.capture(); fs.writeFileSync(file, 'new\n'); const b = engine.capture();
  assert.throws(() => engine.preview(a.id, b.id, ['not-a-hunk']), /Stale or invalid/);
  assert.throws(() => engine.createBranch(a.id, b.id, [], 'main'), /must start/);
  assert.throws(() => engine.createBranch(a.id, b.id, [], 'chronicle/empty'), /Select at least/);
  for (const name of ['../outside', '/absolute', '.git/config', 'C:/outside', 'bad\\name']) assert.throws(() => safePath(root, name), /Unsafe/);
});

test('storage symlinks cannot redirect snapshots into the recorded repository', t => {
  const { root } = fixture(t);
  const base = path.dirname(root);
  const alias = path.join(base, 'storage-alias');
  fs.symlinkSync(root, alias, process.platform === 'win32' ? 'junction' : 'dir');
  assert.throws(() => new Chronicle(root, { storage: alias }), /outside the recorded repository/);
  assert.equal(fs.existsSync(path.join(root, 'blobs')), false);
});

test('repository-specific storage symlinks are resolved before creating snapshot directories', t => {
  const { root } = fixture(t);
  const storage = path.join(path.dirname(root), 'storage-root');
  fs.mkdirSync(storage);
  const store = path.join(storage, hash(fs.realpathSync(root)).slice(0, 24));
  fs.symlinkSync(root, store, process.platform === 'win32' ? 'junction' : 'dir');

  assert.throws(() => new Chronicle(root, { storage }), /outside the recorded repository/);
  for (const directory of ['blobs', 'checkpoints', 'operations', 'worktrees', 'gaps', 'recovery']) {
    assert.equal(fs.existsSync(path.join(root, directory)), false, `${directory} must not be created inside the project`);
  }
});

test('symlinked internal snapshot directories are rejected before redirected writes', t => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'chronicle-store-child-link-'));
  const root = path.join(base, 'repo'); fs.mkdirSync(root);
  git(root, ['init']); git(root, ['config', 'user.name', 'Test']); git(root, ['config', 'user.email', 'test@example.invalid']);
  fs.writeFileSync(path.join(root, 'README.md'), 'safe\n'); git(root, ['add', '.']); git(root, ['commit', '-m', 'Baseline']);
  const storageBase = path.join(base, 'history');
  const store = path.join(storageBase, hash(fs.realpathSync(root)).slice(0, 24));
  fs.mkdirSync(store, { recursive: true });
  fs.symlinkSync(root, path.join(store, 'blobs'), process.platform === 'win32' ? 'junction' : 'dir');
  t.after(() => fs.rmSync(base, { recursive: true, force: true }));

  assert.throws(() => new Chronicle(root, { storage: storageBase }), /Snapshot storage directory must be a real directory/);
  for (const directory of ['checkpoints', 'operations', 'worktrees', 'gaps', 'recovery']) {
    assert.equal(fs.existsSync(path.join(root, directory)), false, `did not create ${directory} in the redirected project`);
  }
});

test('corrupted snapshots fail integrity checks', t => {
  const { engine } = fixture(t); const cp = engine.capture(); const entry = cp.files['README.md'];
  fs.writeFileSync(path.join(engine.store, 'blobs', entry.hash), 'tampered');
  assert.throws(() => engine.bytes(entry), /integrity/);
});

test('interrupted blob publication leaves no poisoned content hash', t => {
  const { engine } = fixture(t);
  const originalLink = fs.linkSync;
  const originalUnlink = fs.unlinkSync;
  fs.linkSync = () => { const error = new Error('simulated interruption'); error.code = 'EIO'; throw error; };
  fs.unlinkSync = file => {
    if (file.startsWith(path.join(engine.store, 'blobs')) && file.endsWith('.tmp')) { const error = new Error('simulated crash before temp cleanup'); error.code = 'EIO'; throw error; }
    return originalUnlink(file);
  };
  try { assert.throws(() => engine.capture(), /simulated crash before temp cleanup/); }
  finally { fs.linkSync = originalLink; fs.unlinkSync = originalUnlink; }
  const digest = hash(Buffer.from('one\ntwo\nthree\n'));
  const entriesAfterInterruption = fs.readdirSync(path.join(engine.store, 'blobs')).filter(name => name.startsWith(digest));
  assert.equal(entriesAfterInterruption.length, 1);
  assert.match(entriesAfterInterruption[0], /\.tmp$/);
  const checkpoint = engine.capture();
  assert.equal(engine.bytes(checkpoint.files['README.md']).toString(), 'one\ntwo\nthree\n');
  assert.equal(fs.existsSync(path.join(engine.store, 'blobs', digest)), true);
});

test('storage recovery quarantines interrupted files without deleting data', t => {
  const { engine } = fixture(t);
  const legacyCheckpoint = engine.capture('Legacy checkpoint', { source: 'claude-code', boundary: 'PostToolUse' });
  const legacyCheckpointPath = path.join(engine.store, 'checkpoints', legacyCheckpoint.id + '.json');
  const legacyCheckpointBytes = fs.readFileSync(legacyCheckpointPath);
  const legacyGap = { schema: 1, kind: 'capture-gap', id: 'legacy-gap', createdAt: new Date().toISOString(), status: 'skipped', reason: 'RECORDER_BUSY', source: 'claude-code', boundary: 'PostToolUseFailure' };
  const legacyGapPath = path.join(engine.store, 'gaps', 'legacy-gap.json');
  fs.writeFileSync(legacyGapPath, JSON.stringify(legacyGap));
  const legacyGapBytes = fs.readFileSync(legacyGapPath);
  const blobTemp = path.join(engine.store, 'blobs', 'dead-write.tmp'); fs.writeFileSync(blobTemp, 'partial blob');
  const checkpointTemp = path.join(engine.store, 'checkpoints', 'dead-checkpoint.tmp'); fs.writeFileSync(checkpointTemp, 'partial metadata');
  const operationTemp = path.join(engine.store, 'operations', 'dead-operation.tmp'); fs.writeFileSync(operationTemp, '{"state":"applying"');
  const pending = path.join(engine.store, 'operations', 'pending.json'); fs.writeFileSync(pending, JSON.stringify({ id: 'pending', state: 'applying' }));
  const result = engine.recoverStorage();
  assert.equal(result.quarantined.length, 3);
  assert.equal(result.pendingOperations[0].id, 'pending');
  assert.equal(fs.existsSync(blobTemp), false);
  assert.equal(fs.readFileSync(result.quarantined.find(f => f.original.startsWith('blobs/')).savedAs, 'utf8'), 'partial blob');
  assert.equal(fs.existsSync(path.join(engine.store, 'operation.lock')), false);
  assert.deepEqual(fs.readFileSync(legacyCheckpointPath), legacyCheckpointBytes);
  assert.deepEqual(fs.readFileSync(legacyGapPath), legacyGapBytes);
});

test('storage recovery refuses a live lock and explicitly preserves a dead lock', async t => {
  const { engine } = fixture(t);
  const child = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 60000)'], { windowsHide: true, stdio: 'ignore' });
  t.after(() => { if (child.exitCode === null) child.kill(); });
  await once(child, 'spawn');
  const lock = path.join(engine.store, 'operation.lock'); fs.writeFileSync(lock, String(child.pid), { flag: 'wx' });
  assert.throws(() => engine.recoverStorage(true), /still running/);
  assert.equal(fs.existsSync(lock), true);
  child.kill(); await once(child, 'exit');
  assert.throws(() => engine.recoverStorage(false), /confirm-stale-lock/);
  assert.equal(fs.existsSync(lock), true);
  const recovered = engine.recoverStorage(true);
  assert.equal(fs.existsSync(lock), false);
  assert.equal(fs.readFileSync(recovered.staleLock, 'utf8'), String(child.pid));
});

test('existing branches produce failed journal entries and preserve source', t => {
  const { root, engine, file } = fixture(t); const a = engine.capture(); fs.writeFileSync(file, 'new\n'); const b = engine.capture();
  const ids = engine.compare(a.id, b.id).changes.flatMap(f => f.hunks.map(h => h.id));
  git(root, ['branch', 'chronicle/existing']);
  assert.throws(() => engine.createBranch(a.id, b.id, ids, 'chronicle/existing'), /Operation recorded/);
  assert.equal(engine.operations()[0].state, 'failed');
  assert.equal(engine.reconcileOperations()[0].assessment, 'branch-exists-worktree-unavailable');
  assert.equal(fs.readFileSync(file, 'utf8'), 'new\n');
});

test('operation reconciliation identifies interrupted worktrees and preserves later edits', t => {
  const { root, engine, file } = fixture(t);
  const a = engine.capture(); fs.writeFileSync(file, 'selected edit\n'); const b = engine.capture();
  const ids = engine.compare(a.id, b.id).changes.flatMap(change => change.hunks.map(hunk => hunk.id));
  const operation = engine.createBranch(a.id, b.id, ids, 'chronicle/interrupted');
  const journal = path.join(engine.store, 'operations', operation.id + '.json');
  const recorded = JSON.parse(fs.readFileSync(journal, 'utf8'));
  recorded.state = 'prepared'; fs.writeFileSync(journal, JSON.stringify(recorded));
  assert.equal(engine.reconcileOperations()[0].assessment, 'worktree-created-before-journal-update');
  recorded.state = 'applying'; fs.writeFileSync(journal, JSON.stringify(recorded));
  const output = path.join(operation.target, 'README.md'); fs.writeFileSync(output, 'developer follow-up\n');
  recorded.state = 'completed'; fs.writeFileSync(journal, JSON.stringify(recorded));
  const completedStatus = engine.reconcileOperations()[0];
  assert.equal(completedStatus.assessment, 'completed-worktree-modified');
  assert.equal(completedStatus.modifiedSinceCompletion, true);
  recorded.state = 'applying'; fs.writeFileSync(journal, JSON.stringify(recorded));
  const status = engine.reconcileOperations()[0];
  assert.equal(status.recordedState, 'applying');
  assert.equal(status.assessment, 'interrupted-worktree');
  assert.equal(status.worktreeRegistered, true);
  assert.equal(status.branchExists, true);
  assert.equal(status.dirty, true);
  recorded.state = 'failed'; fs.writeFileSync(journal, JSON.stringify(recorded));
  assert.equal(engine.reconcileOperations()[0].assessment, 'failed-worktree-retained');
  assert.equal(fs.readFileSync(output, 'utf8'), 'developer follow-up\n');
  assert.equal(fs.readFileSync(file, 'utf8'), 'selected edit\n');
  assert.equal(JSON.parse(fs.readFileSync(journal, 'utf8')).state, 'failed');
});

test('failed Claude tool boundaries capture partial edits without storing tool secrets', t => {
  const { root, engine, file } = fixture(t);
  const options = { storage: path.dirname(engine.store) };
  recordHook({ cwd: root, hook_event_name: 'PreToolUse', session_id: 'session', tool_name: 'Bash', tool_use_id: 'tool-1', tool_input: { command: 'SECRET_COMMAND' } }, options);
  fs.writeFileSync(file, 'partially written before failure\n');
  const cp = recordHook({ cwd: root, hook_event_name: 'PostToolUseFailure', session_id: 'session', tool_name: 'Bash', tool_use_id: 'tool-1', error: 'SECRET_ERROR' }, options);
  assert.equal(engine.list().length, 2);
  assert.equal(cp.event.status, 'failed');
  assert.equal(cp.event.contract, 'chronicle.adapter-event');
  assert.equal(cp.event.contractVersion, 1);
  assert.match(cp.event.eventId, /^[a-f0-9-]{36}$/);
  assert.equal(cp.event.statusCertainty, 'host-reported');
  assert.equal(cp.event.timestampSource, 'recorder');
  assert.equal(cp.event.references.snapshotId, cp.id);
  assert.equal(cp.event.references.gapId, null);
  assert.equal(engine.bytes(cp.files['README.md']).toString(), 'partially written before failure\n');
  assert.equal(JSON.stringify(cp).includes('SECRET_'), false);
});

test('Codex hook boundaries record local file changes without storing prompts or claiming tool success', t => {
  const { root, engine, file } = fixture(t);
  const options = { storage: path.dirname(engine.store) };
  const before = recordHook({ cwd: root, hook_event_name: 'PreToolUse', session_id: 'codex-session', turn_id: 'turn-1', tool_name: 'apply_patch', tool_use_id: 'tool-2', tool_input: { command: 'SECRET_PROMPT' } }, options, 'codex-cli');
  fs.writeFileSync(file, 'Codex output\n');
  const after = recordHook({ cwd: root, hook_event_name: 'PostToolUse', session_id: 'private/session token', turn_id: 'turn-1', tool_name: 'apply_patch', tool_use_id: 'tool-2', tool_response: 'SECRET_OUTPUT' }, options, 'codex-cli');
  assert.equal(before.event.source, 'codex-cli');
  assert.equal(before.event.contractVersion, 1);
  assert.equal(before.event.statusCertainty, 'boundary-only');
  assert.equal(before.event.references.snapshotId, before.id);
  assert.equal(after.event.status, 'observed');
  assert.equal(after.event.statusCertainty, 'boundary-only');
  assert.equal(after.event.references.snapshotId, after.id);
  assert.equal(after.event.turnId, 'turn-1');
  assert.equal(after.event.sessionId, undefined);
  assert.equal(Number.isNaN(Date.parse(after.event.recordedAt)), false);
  assert.equal(after.event.privacy, 'metadata-only');
  assert.equal(engine.bytes(after.files['README.md']).toString(), 'Codex output\n');
  assert.equal(JSON.stringify([before, after]).includes('SECRET_'), false);
  assert.throws(() => recordHook({ cwd: root, hook_event_name: 'PostToolUseFailure', session_id: 'codex-session' }, options, 'codex-cli'), /Unsupported/);
  assert.throws(() => recordHook({ cwd: root, hook_event_name: 'NewHostEvent', session_id: 'codex-session' }, options, 'codex-cli'), /Unsupported/);
  assert.throws(() => recordHook({ cwd: root, hook_event_name: 'PostToolUse', session_id: 'session' }, options, 'unknown-adapter'), /Unsupported/);
  assert.equal(engine.list().length, 2);
  assert.equal(engine.gaps().length, 0);
});

test('Codex plugin config references only fixture-supported lifecycle hooks', () => {
  const plugin = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'plugin.json'), 'utf8'));
  const config = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'hooks', 'codex-hooks.json'), 'utf8'));
  assert.equal(plugin.extensions['com.openai'].hooks, './hooks/codex-hooks.json');
  assert.deepEqual(Object.keys(config.hooks).sort(), ['Interrupt', 'PostToolUse', 'PreToolUse', 'SessionEnd', 'SessionStart'].sort());
  for (const name of ['PreToolUse', 'PostToolUse']) assert.equal(config.hooks[name][0].matcher, 'Bash|apply_patch|Edit|Write');
  for (const name of Object.keys(config.hooks)) for (const group of config.hooks[name]) for (const hook of group.hooks) assert.match(hook.command, /src\/hook\.js.*codex/);
});

test('failed capture is recorded as a bounded gap and attached to its checkpoint interval', t => {
  const { root, engine } = fixture(t);
  const options = { storage: path.dirname(engine.store) };
  const before = engine.capture('Before blocked tool');
  const payload = { cwd: root, hook_event_name: 'PostToolUseFailure', session_id: 'safe-session-id', tool_name: 'Bash', tool_use_id: 'safe-tool-id', tool_input: { command: 'SECRET_COMMAND' }, error: 'SECRET_ERROR at private/path' };
  engine.exclusive(() => assert.throws(() => recordHook(payload, options), /Chronicle is busy/));
  const gap = engine.gaps();
  assert.equal(gap.length, 1);
  assert.equal(gap[0].reason, 'RECORDER_BUSY');
  assert.equal(gap[0].sessionId, payload.session_id);
  assert.equal(gap[0].event.contractVersion, 1);
  assert.equal(gap[0].event.references.snapshotId, null);
  assert.equal(gap[0].event.references.gapId, gap[0].id);
  assert.equal(gap[0].event.statusCertainty, 'host-reported');
  assert.equal(JSON.stringify(gap).includes('SECRET_'), false);
  assert.equal(JSON.stringify(gap).includes(root), false);
  const after = engine.capture('After blocked tool');
  assert.equal(engine.compare(before.id, after.id).gaps.length, 1);
});

test('CLI can inspect gaps without invoking a model or exposing raw tool errors', t => {
  const { root, engine } = fixture(t);
  engine.recordGap({ boundary: 'PostToolUseFailure', sessionId: 'session-safe', tool: 'Bash' }, new Error('busy during SECRET_COMMAND at private/path'));
  const cli = path.join(__dirname, '..', 'src', 'cli.js');
  const result = spawnSync(process.execPath, [cli, 'gaps'], { cwd: root, encoding: 'utf8', env: { ...process.env, CHRONICLE_HOME: path.dirname(engine.store) } });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /RECORDER_BUSY/);
  assert.equal(result.stdout.includes('SECRET_COMMAND'), false);
  assert.equal(result.stdout.includes(root), false);
});

test('CLI reconciliation reports interrupted output without changing it', t => {
  const { root, engine, file } = fixture(t);
  const a = engine.capture(); fs.writeFileSync(file, 'selected\n'); const b = engine.capture();
  const ids = engine.compare(a.id, b.id).changes.flatMap(change => change.hunks.map(hunk => hunk.id));
  const operation = engine.createBranch(a.id, b.id, ids, 'chronicle/cli-reconcile');
  const journal = path.join(engine.store, 'operations', operation.id + '.json');
  const record = JSON.parse(fs.readFileSync(journal, 'utf8')); record.state = 'applying'; fs.writeFileSync(journal, JSON.stringify(record));
  const targetFile = path.join(operation.target, 'README.md'); fs.writeFileSync(targetFile, 'keep my recovery edits\n');
  const cli = path.join(__dirname, '..', 'src', 'cli.js');
  const result = spawnSync(process.execPath, [cli, 'reconcile'], { cwd: root, encoding: 'utf8', env: { ...process.env, CHRONICLE_HOME: path.dirname(engine.store) } });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /interrupted-worktree/);
  assert.match(result.stdout, /"dirty": true/);
  assert.equal(fs.readFileSync(targetFile, 'utf8'), 'keep my recovery edits\n');
});

test('gap history is capped and exposes the overflow state', t => {
  const { engine } = fixture(t);
  for (let i = 0; i < 1001; i++) engine.recordGap({ boundary: 'PostToolUse', tool: 'Bash' }, new Error('busy'));
  const gaps = engine.gaps();
  assert.equal(gaps.filter(g => g.kind === 'capture-gap').length, 1000);
  assert.equal(gaps.some(g => g.kind === 'capture-gap-limit'), true);
});

test('concurrent operations stop rather than interleave mutations', t => {
  const { engine } = fixture(t);
  engine.exclusive(() => assert.throws(() => engine.capture(), /Chronicle is busy/));
  assert.equal(engine.capture().schema, 1);
});

test('inherited Git directory and index overrides cannot redirect capture', t => {
  const { root, engine } = fixture(t);
  const previous = { GIT_DIR: process.env.GIT_DIR, GIT_INDEX_FILE: process.env.GIT_INDEX_FILE };
  process.env.GIT_DIR = path.join(root, 'nonexistent'); process.env.GIT_INDEX_FILE = path.join(root, 'wrong-index');
  try { assert.equal(engine.capture().root, fs.realpathSync(root)); assert.equal(fs.existsSync(process.env.GIT_INDEX_FILE), false); }
  finally { for (const [name, value] of Object.entries(previous)) { if (value === undefined) delete process.env[name]; else process.env[name] = value; } }
});
