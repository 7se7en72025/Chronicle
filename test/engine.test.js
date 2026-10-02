'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { Chronicle, git, hash, safePath } = require('../src/engine');
const { recordHook } = require('../src/hook');

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

test('corrupted snapshots fail integrity checks', t => {
  const { engine } = fixture(t); const cp = engine.capture(); const entry = cp.files['README.md'];
  fs.writeFileSync(path.join(engine.store, 'blobs', entry.hash), 'tampered');
  assert.throws(() => engine.bytes(entry), /integrity/);
});

test('existing branches produce failed journal entries and preserve source', t => {
  const { root, engine, file } = fixture(t); const a = engine.capture(); fs.writeFileSync(file, 'new\n'); const b = engine.capture();
  const ids = engine.compare(a.id, b.id).changes.flatMap(f => f.hunks.map(h => h.id));
  git(root, ['branch', 'chronicle/existing']);
  assert.throws(() => engine.createBranch(a.id, b.id, ids, 'chronicle/existing'), /Operation recorded/);
  assert.equal(engine.operations()[0].state, 'failed');
  assert.equal(fs.readFileSync(file, 'utf8'), 'new\n');
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
