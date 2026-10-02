'use strict';

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const { TextDecoder } = require('node:util');

const hash = value => crypto.createHash('sha256').update(value).digest('hex');
const MAX_FILE = 1024 * 1024;
const MAX_TOTAL = 32 * 1024 * 1024;
const forbidden = /(^|\/)(\.git|\.env(?:\..*)?|node_modules|dist|build|\.chronicle-dev|\.ssh)(\/|$)|\.(pem|key|p12|pfx)$/i;
const lines = text => text.match(/[^\n]*\n|[^\n]+$/g) || [];

function git(root, args, accepted = [0]) {
  // Inherited Git overrides can redirect commands to a different repository/index.
  const env = { ...process.env };
  for (const name of Object.keys(env)) if (name.startsWith('GIT_')) delete env[name];
  const result = spawnSync('git', ['-c', 'core.hooksPath=' + path.join(os.tmpdir(), 'chronicle-no-hooks'), ...args], {
    cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, timeout: 30000,
    env: { ...env, GIT_OPTIONAL_LOCKS: '0', GIT_TERMINAL_PROMPT: '0' }, windowsHide: true
  });
  if (result.error) throw result.error;
  if (!accepted.includes(result.status)) throw new Error((result.stderr || result.stdout || 'Git failed').trim());
  return result.stdout;
}

function safePath(root, relative) {
  if (typeof relative !== 'string' || !relative || relative.includes('\\') || relative.includes(':') || relative.includes('\0') || path.isAbsolute(relative) || relative.split('/').some(p => p === '..' || p === '.' || p.toLowerCase() === '.git')) {
    throw new Error('Unsafe repository path');
  }
  const resolved = path.resolve(root, relative);
  if (!resolved.startsWith(path.resolve(root) + path.sep)) throw new Error('Path escapes workspace');
  let cursor = root;
  for (const part of relative.split('/')) {
    cursor = path.join(cursor, part);
    try { if (fs.lstatSync(cursor).isSymbolicLink()) throw new Error('Symlink paths are unsupported: ' + relative); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  return resolved;
}

function text(bytes) {
  if (bytes.includes(0)) throw new Error('Binary file');
  return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
}

function writeJson(file, value) {
  const temp = file + '.' + crypto.randomUUID() + '.tmp';
  const fd = fs.openSync(temp, 'wx', 0o600);
  try { fs.writeFileSync(fd, JSON.stringify(value, null, 2)); fs.fsyncSync(fd); }
  finally { fs.closeSync(fd); }
  fs.renameSync(temp, file);
}

class Chronicle {
  constructor(root, options = {}) {
    this.root = fs.realpathSync(git(root, ['rev-parse', '--show-toplevel']).trim());
    const base = options.storage || process.env.CHRONICLE_HOME || path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), '.local', 'share'), 'Chronicle');
    this.store = path.join(path.resolve(base), hash(this.root).slice(0, 24));
    if (this.store.startsWith(this.root + path.sep)) throw new Error('Snapshot storage must be outside the recorded repository');
    for (const dir of ['blobs', 'checkpoints', 'operations', 'worktrees']) fs.mkdirSync(path.join(this.store, dir), { recursive: true, mode: 0o700 });
  }

  exclusive(action) {
    const file = path.join(this.store, 'operation.lock');
    let fd;
    try { fd = fs.openSync(file, 'wx', 0o600); }
    catch (error) { if (error.code === 'EEXIST') throw new Error('Chronicle is busy, or an interrupted process left operation.lock. Confirm no helper is running before removing that lock.'); throw error; }
    try { fs.writeFileSync(fd, String(process.pid)); return action(); }
    finally { fs.closeSync(fd); fs.unlinkSync(file); }
  }

  inventory() {
    const tracked = git(this.root, ['ls-files', '-z']).split('\0').filter(Boolean);
    const modes = new Map(git(this.root, ['ls-files', '--stage', '-z']).split('\0').filter(Boolean).map(record => {
      const tab = record.indexOf('\t'); return [record.slice(tab + 1), record.slice(0, 6)];
    }));
    const candidates = [...new Set([...tracked, ...git(this.root, ['ls-files', '--others', '--exclude-standard', '-z']).split('\0').filter(Boolean)])].sort();
    const files = Object.create(null), excluded = [];
    let total = 0;
    for (const name of candidates) {
      if (forbidden.test(name)) { excluded.push({ path: name, reason: 'Excluded path policy' }); continue; }
      try {
        const full = safePath(this.root, name), stat = fs.lstatSync(full);
        if (!stat.isFile()) throw new Error('Only regular files are supported');
        if (stat.size > MAX_FILE) throw new Error('File exceeds 1 MiB limit');
        const bytes = fs.readFileSync(full); text(bytes);
        total += bytes.length;
        if (total > MAX_TOTAL) throw new Error('Snapshot exceeds 32 MiB limit');
        if (modes.get(name) && !['100644', '100755'].includes(modes.get(name))) throw new Error('Unsupported Git file mode');
        files[name] = { hash: hash(bytes), mode: process.platform === 'win32' ? modes.get(name) || '100644' : stat.mode & 0o111 ? '100755' : '100644', bytes };
      } catch (error) {
        if (error.code === 'ENOENT') continue;
        if (error.message === 'Snapshot exceeds 32 MiB limit') throw error;
        excluded.push({ path: name, reason: error.message });
      }
    }
    return { files, excluded, tracked: [...new Set(tracked)].sort() };
  }

  capture(label = 'Checkpoint', event = { source: 'manual', attribution: 'unknown' }) {
    return this.exclusive(() => {
      const head = git(this.root, ['rev-parse', 'HEAD']).trim();
      const index = git(this.root, ['ls-files', '--stage', '-z']);
      const first = this.inventory(), second = this.inventory();
      const fingerprint = inv => JSON.stringify({ files: Object.entries(inv.files).map(([p, f]) => [p, f.hash, f.mode]), excluded: inv.excluded, tracked: inv.tracked });
      if (fingerprint(first) !== fingerprint(second) || git(this.root, ['rev-parse', 'HEAD']).trim() !== head || git(this.root, ['ls-files', '--stage', '-z']) !== index) throw new Error('Workspace changed during capture. Retry after writes finish.');
      const files = Object.create(null);
      for (const [name, file] of Object.entries(first.files)) {
        const target = path.join(this.store, 'blobs', file.hash);
        try {
          const fd = fs.openSync(target, 'wx', 0o600);
          try { fs.writeFileSync(fd, file.bytes); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
        }
        catch (error) { if (error.code !== 'EEXIST') throw error; }
        if (hash(fs.readFileSync(target)) !== file.hash) throw new Error('Existing blob is damaged; checkpoint was not saved');
        files[name] = { hash: file.hash, mode: file.mode };
      }
      const checkpoint = { schema: 1, id: crypto.randomUUID(), label: String(label).slice(0, 200), createdAt: new Date().toISOString(), root: this.root, head, files, tracked: first.tracked, excluded: first.excluded, event };
      // Index evidence is separate; no command stages or resets the original index.
      checkpoint.index = index;
      writeJson(path.join(this.store, 'checkpoints', checkpoint.id + '.json'), checkpoint);
      return checkpoint;
    });
  }

  list() {
    return fs.readdirSync(path.join(this.store, 'checkpoints')).filter(n => n.endsWith('.json')).map(n => JSON.parse(fs.readFileSync(path.join(this.store, 'checkpoints', n), 'utf8'))).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }

  checkpoint(id) {
    if (typeof id !== 'string' || !/^[a-f0-9-]{36}$/.test(id)) throw new Error('Invalid checkpoint ID');
    const cp = JSON.parse(fs.readFileSync(path.join(this.store, 'checkpoints', id + '.json'), 'utf8'));
    if (cp.root !== this.root || cp.schema !== 1) throw new Error('Checkpoint does not belong to this workspace');
    return cp;
  }

  bytes(file) {
    if (!file) return Buffer.alloc(0);
    if (!/^[a-f0-9]{64}$/.test(file.hash)) throw new Error('Invalid blob hash');
    const bytes = fs.readFileSync(path.join(this.store, 'blobs', file.hash));
    if (hash(bytes) !== file.hash) throw new Error('Snapshot integrity check failed');
    return bytes;
  }

  compare(from, to) {
    const before = this.checkpoint(from), after = this.checkpoint(to);
    const blocked = new Set([...before.excluded, ...after.excluded].map(f => f.path));
    const changes = [];
    for (const name of [...new Set([...Object.keys(before.files), ...Object.keys(after.files)])].sort()) {
      if (blocked.has(name)) continue;
      const a = before.files[name], b = after.files[name];
      if (a?.hash === b?.hash && a?.mode === b?.mode) continue;
      const oldText = text(this.bytes(a)), newText = text(this.bytes(b));
      const fileId = hash(JSON.stringify([from, to, name, a, b]));
      let hunks;
      if (!a || !b || a.mode !== b.mode) {
        hunks = [{ id: fileId + ':0', wholeFile: true, oldStart: 0, oldCount: lines(oldText).length, newStart: 0, newCount: lines(newText).length, patch: (!a ? 'Add file' : !b ? 'Delete file' : 'File mode change') + '\n' + newText }];
      } else {
        const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'chronicle-diff-'));
        try {
          fs.writeFileSync(path.join(temp, 'before'), this.bytes(a)); fs.writeFileSync(path.join(temp, 'after'), this.bytes(b));
          const patch = git(temp, ['diff', '--no-index', '--no-ext-diff', '--no-textconv', '--text', '--unified=3', '--', 'before', 'after'], [0, 1]);
          const headers = [...patch.matchAll(/^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@.*$/gm)];
          hunks = headers.map((h, i) => {
            const oldCount = h[2] === undefined ? 1 : Number(h[2]), newCount = h[4] === undefined ? 1 : Number(h[4]);
            return { id: fileId + ':' + i, oldStart: Number(h[1]) - (oldCount ? 1 : 0), oldCount, newStart: Number(h[3]) - (newCount ? 1 : 0), newCount, patch: patch.slice(h.index, headers[i + 1]?.index || patch.length) };
          });
        } finally { fs.rmSync(temp, { recursive: true, force: true }); }
      }
      changes.push({ path: name, type: !a ? 'added' : !b ? 'deleted' : 'modified', hunks });
    }
    return { from, to, changes, excluded: [...before.excluded, ...after.excluded], modelRequests: 0 };
  }

  preview(from, to, selected) {
    if (!Array.isArray(selected) || selected.some(id => typeof id !== 'string')) throw new Error('Selection must be a list of hunk IDs');
    const diff = this.compare(from, to), chosen = new Set(selected);
    const known = new Set(diff.changes.flatMap(f => f.hunks.map(h => h.id)));
    for (const id of chosen) if (!known.has(id)) throw new Error('Stale or invalid selection');
    const before = this.checkpoint(from), after = this.checkpoint(to), result = [];
    for (const change of diff.changes) {
      const hunks = change.hunks.filter(h => chosen.has(h.id));
      if (!hunks.length) continue;
      const oldLines = lines(text(this.bytes(before.files[change.path]))), newLines = lines(text(this.bytes(after.files[change.path])));
      let content;
      if (hunks[0].wholeFile) content = after.files[change.path] ? text(this.bytes(after.files[change.path])) : null;
      else {
        const output = []; let cursor = 0;
        for (const hunk of hunks) {
          if (hunk.oldStart < cursor) throw new Error('Overlapping selection');
          output.push(...oldLines.slice(cursor, hunk.oldStart), ...newLines.slice(hunk.newStart, hunk.newStart + hunk.newCount));
          cursor = hunk.oldStart + hunk.oldCount;
        }
        output.push(...oldLines.slice(cursor)); content = output.join('');
      }
      result.push({ path: change.path, content, mode: after.files[change.path]?.mode || before.files[change.path].mode });
    }
    return { from, to, files: result, selected: [...chosen], modelRequests: 0 };
  }

  createBranch(from, to, selected, branch) {
    return this.exclusive(() => {
      if (typeof branch !== 'string' || !branch.startsWith('chronicle/') || branch.length > 120) throw new Error('Output branch must start with chronicle/');
      git(this.root, ['check-ref-format', '--branch', branch]);
      const preview = this.preview(from, to, selected);
      if (!preview.files.length) throw new Error('Select at least one change');
      const baseline = this.checkpoint(from);
      // An incomplete baseline cannot be represented as an exact selected output.
      if (baseline.excluded.length || this.checkpoint(to).excluded.length) throw new Error('Capture has excluded files. Use a smaller text-only fixture for branch output in this prototype.');
      const id = crypto.randomUUID(), target = path.join(this.store, 'worktrees', id);
      const journal = path.join(this.store, 'operations', id + '.json');
      const op = { id, from, to, selected, branch, target, state: 'prepared', createdAt: new Date().toISOString(), modelRequests: 0 };
      writeJson(journal, op);
      try {
        git(this.root, ['worktree', 'add', '-b', branch, '--', target, baseline.head]);
        op.state = 'applying'; writeJson(journal, op);
        const headFiles = git(target, ['ls-files', '-z']).split('\0').filter(Boolean);
        // Baseline includes untracked additions and tracked deletions, not only HEAD.
        for (const name of headFiles) if (!Object.hasOwn(baseline.files, name)) {
          const full = safePath(target, name);
          if (fs.existsSync(full)) { if (!fs.lstatSync(full).isFile()) throw new Error('Unsupported baseline entry: ' + name); fs.unlinkSync(full); }
        }
        const expected = new Map();
        for (const [name, file] of Object.entries(baseline.files)) expected.set(name, { bytes: this.bytes(file), mode: file.mode });
        for (const file of preview.files) {
          if (file.content === null) expected.delete(file.path);
          else expected.set(file.path, { bytes: Buffer.from(file.content, 'utf8'), mode: file.mode });
        }
        for (const file of preview.files) if (file.content === null) {
          const full = safePath(target, file.path); if (fs.existsSync(full)) fs.unlinkSync(full);
        }
        for (const [name, file] of expected) {
          const full = safePath(target, name); fs.mkdirSync(path.dirname(full), { recursive: true });
          fs.writeFileSync(full, file.bytes);
          if (process.platform !== 'win32') fs.chmodSync(full, file.mode === '100755' ? 0o755 : 0o644);
          if (hash(fs.readFileSync(full)) !== hash(file.bytes)) throw new Error('Output verification failed: ' + name);
        }
        op.state = 'completed'; op.files = [...expected].map(([name, file]) => ({ path: name, hash: hash(file.bytes) })); writeJson(journal, op);
        return op;
      } catch (error) {
        op.state = 'failed'; op.error = error.message; writeJson(journal, op);
        throw new Error(error.message + '\nOperation recorded at ' + journal + '. Any created worktree is retained for inspection.');
      }
    });
  }

  operations() {
    return fs.readdirSync(path.join(this.store, 'operations')).filter(n => n.endsWith('.json')).map(n => JSON.parse(fs.readFileSync(path.join(this.store, 'operations', n), 'utf8')));
  }
}

module.exports = { Chronicle, git, hash, safePath };
