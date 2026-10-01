import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { ChronicleEngine, digest } from '../server/engine.mjs';
import { DEFAULT_FIX, FILES } from '../server/fixture.mjs';

async function workspace(t) {
  const dir = await mkdtemp(path.join(tmpdir(), 'chronicle-test-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const engine = new ChronicleEngine(dir); await engine.init(); return engine;
}
test('failed demo records the exact action, context and two contract failures', async t => {
  const engine = await workspace(t); const run = await engine.createRun();
  assert.equal(run.status, 'failed'); assert.equal(run.checkpoints.length, 7);
  assert.deepEqual(run.assertions.filter(a => !a.passed).map(a => a.id), ['anonymous', 'ownership']);
  assert.equal(run.checkpoints[2].environment.files['auth.js'], FILES['auth.js']);
  assert.match(run.checkpoints[3].environment.files['auth.js'], /return true/);
  assert.equal(run.checkpoints[2].event.observation, FILES['auth.js']);
  for (const cp of run.checkpoints) assert.equal(cp.hash, digest(cp.environment));
});
test('a branch restores the selected checkpoint and writes to an isolated workspace', async t => {
  const engine = await workspace(t); const original = await engine.createRun();
  const originalBytes = JSON.stringify(original); const checkpoint = original.checkpoints[2];
  const branch = await engine.branch(original.id, 2, DEFAULT_FIX, 'Keep auth');
  assert.equal(branch.status, 'passed'); assert.equal(branch.parentId, original.id); assert.equal(branch.restoredHash, checkpoint.hash);
  assert.equal(JSON.stringify(original), originalBytes);
  assert.equal(branch.checkpoints[3].environment.database.projects.length, 3);
  assert.equal(branch.checkpoints.at(-1).environment.files['auth.js'], FILES['auth.js']);
  const rootAuth = await readFile(path.join(engine.root, 'workspaces', original.id, 'auth.js'), 'utf8');
  const branchAuth = await readFile(path.join(engine.root, 'workspaces', branch.id, 'auth.js'), 'utf8');
  assert.notEqual(rootAuth, branchAuth);
});
test('intervening after the failed action re-verifies the corrected environment', async t => {
  const engine = await workspace(t); const original = await engine.createRun();
  const branch = await engine.branch(original.id, 6, DEFAULT_FIX);
  assert.equal(branch.status, 'passed'); assert.equal(branch.checkpoints.at(-1).event.type, 'test');
  assert.ok(branch.checkpoints.some(cp => cp.event.title === 'Restore authentication guard'));
});
test('an unrelated instruction does not magically repair the run', async t => {
  const engine = await workspace(t); const original = await engine.createRun();
  const branch = await engine.branch(original.id, 2, 'Make the cards bright purple.');
  assert.equal(branch.status, 'failed');
});
test('regression suite starts from the original fixture, and detects a bad instruction', async t => {
  const engine = await workspace(t); const original = await engine.createRun();
  const branch = await engine.branch(original.id, 2, DEFAULT_FIX); const saved = await engine.saveTest(branch.id);
  assert.equal(saved.fixture.files['app.js'], FILES['app.js']);
  assert.equal((await engine.runTests())[0].passed, true);
  saved.instruction = 'Make the cards bright purple.';
  assert.equal((await engine.runTests())[0].passed, false);
  assert.equal(saved.executions.length, 2);
});
test('failed runs cannot be saved as verified regression tests', async t => {
  const engine = await workspace(t); const run = await engine.createRun();
  await assert.rejects(engine.saveTest(run.id), /Only a verified passing run/);
});
test('state and checkpoint notes survive an engine restart', async t => {
  const engine = await workspace(t); const run = await engine.createRun();
  await engine.comment(run.id, 3, 'This action removed the session guard.');
  const reboot = new ChronicleEngine(engine.root); await reboot.init();
  assert.equal(reboot.getRun(run.id).status, 'failed'); assert.equal(reboot.state.comments[0].index, 3);
  assert.equal(reboot.state.comments[0].body, 'This action removed the session guard.');
});
test('capsule includes initial fixture, recorded evidence and explicit restoration limits', async t => {
  const engine = await workspace(t); const run = await engine.createRun(); const capsule = engine.capsule(run.id);
  assert.equal(capsule.format, 'chronicle-capsule'); assert.equal(capsule.run.checkpoints.length, 7);
  assert.equal(capsule.fixture.files['auth.js'], FILES['auth.js']);
  assert.match(capsule.restoration.browser, /not a live browser process/);
  capsule.fixture.files['auth.js'] = 'changed'; assert.equal(run.checkpoints[0].environment.files['auth.js'], FILES['auth.js']);
});
test('missing checkpoints and invalid intervention inputs fail before creating a branch', async t => {
  const engine = await workspace(t); const run = await engine.createRun();
  await assert.rejects(engine.branch(run.id, 999, DEFAULT_FIX), /Checkpoint not found/);
  await assert.rejects(engine.branch(run.id, 2, 'short'), /between 8/);
  await assert.rejects(engine.comment(run.id, 2, ''), /Comment must/);
  assert.equal(engine.state.runs.length, 1);
});
test('real browser assertions can fail an otherwise valid source contract', async t => {
  const engine = await workspace(t); engine.capture = async () => ({ screenshot: null, storage: { cookies: [], origins: [] }, browser: { available: true, assertions: [{ label: 'Browser contract', passed: false, detail: 'Unexpected rendering failure.' }] } });
  const run = await engine.createRun(); const branch = await engine.branch(run.id, 2, DEFAULT_FIX);
  assert.equal(branch.status, 'failed'); assert.equal(branch.assertions.at(-1).id, 'browser-0');
});
