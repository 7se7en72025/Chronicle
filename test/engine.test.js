'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
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

test('CRLF, Unicode, BOM, and missing final newline survive selected output', t => {
  const { engine, file } = fixture(t, '\ufeffhello\r\n世界\r\nlast');
  const a = engine.capture(); fs.writeFileSync(file, '\ufeffhello\r\nchanged 世界\r\nlast'); const b = engine.capture();
  const diff = engine.compare(a.id, b.id);
  const preview = engine.preview(a.id, b.id, diff.changes.flatMap(f => f.hunks.map(h => h.id)));
  assert.equal(preview.files[0].content, '\ufeffhello\r\nchanged 世界\r\nlast');
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
  assert.equal(engine.reconcileOperations()[0].modifiedSinceCompletion, false);
  fs.writeFileSync(path.join(op.target, 'README.md'), 'restored later\n');
  assert.equal(engine.reconcileOperations()[0].assessment, 'completed-worktree-modified');
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
  assert.equal(engine.bytes(cp.files['README.md']).toString(), 'partially written before failure\n');
  assert.equal(JSON.stringify(cp).includes('SECRET_'), false);
});

test('Codex hook boundaries record local file changes without storing prompts or claiming tool success', t => {
  const { root, engine, file } = fixture(t);
  const options = { storage: path.dirname(engine.store) };
  const before = recordHook({ cwd: root, hook_event_name: 'PreToolUse', session_id: 'codex-session', turn_id: 'turn-1', tool_name: 'apply_patch', tool_use_id: 'tool-2', tool_input: { command: 'SECRET_PROMPT' } }, options, 'codex-cli');
  fs.writeFileSync(file, 'Codex output\n');
  const after = recordHook({ cwd: root, hook_event_name: 'PostToolUse', session_id: 'codex-session', turn_id: 'turn-1', tool_name: 'apply_patch', tool_use_id: 'tool-2', tool_response: 'SECRET_OUTPUT' }, options, 'codex-cli');
  assert.equal(before.event.source, 'codex-cli');
  assert.equal(after.event.status, 'observed');
  assert.equal(after.event.turnId, 'turn-1');
  assert.equal(engine.bytes(after.files['README.md']).toString(), 'Codex output\n');
  assert.equal(JSON.stringify([before, after]).includes('SECRET_'), false);
  assert.throws(() => recordHook({ cwd: root, hook_event_name: 'PostToolUseFailure', session_id: 'codex-session' }, options, 'codex-cli'), /Unsupported/);
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
