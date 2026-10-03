'use strict';

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const { spawn, spawnSync } = require('node:child_process');
const { TextDecoder } = require('node:util');
const { createSimulatedReplayMcp } = require('./simulated-replay-mcp');

const hash = value => crypto.createHash('sha256').update(value).digest('hex');
const MAX_FILE = 1024 * 1024;
const MAX_TOTAL = 32 * 1024 * 1024;
const forbidden = /(^|\/)(\.git|\.env(?:\..*)?|node_modules|dist|build|\.chronicle-dev|\.ssh)(\/|$)|\.(pem|key|p12|pfx)$/i;
const lines = text => text.match(/[^\n]*\n|[^\n]+$/g) || [];

function changeGroups(hunk) {
  const rows = hunk.patch.split(/\r?\n/).slice(1);
  const groups = [];
  let oldOffset = 0, newOffset = 0, pending;
  const flush = () => {
    if (!pending) return;
    groups.push({
      oldStart: hunk.oldStart + pending.oldOffset, newStart: hunk.newStart + pending.newOffset,
      oldCount: pending.oldCount, newCount: pending.newCount, patch: pending.rows.join('\n')
    });
    pending = undefined;
  };
  for (const row of rows) {
    if (row.startsWith('-') || row.startsWith('+')) {
      if (!pending) pending = { oldOffset, newOffset, oldCount: 0, newCount: 0, rows: [] };
      pending.rows.push(row);
      if (row.startsWith('-')) { pending.oldCount++; oldOffset++; }
      else { pending.newCount++; newOffset++; }
    } else if (row.startsWith(' ')) {
      flush(); oldOffset++; newOffset++;
    }
    // The "\ No newline at end of file" marker describes the prior edit and
    // does not consume a source or result line.
  }
  flush();
  return groups.map((group, index) => ({ ...group, id: hunk.id + ':g' + index }));
}

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
    let storageBase = path.resolve(base), probe = storageBase;
    const remainder = [];
    while (!fs.existsSync(probe)) { remainder.unshift(path.basename(probe)); const parent = path.dirname(probe); if (parent === probe) break; probe = parent; }
    storageBase = path.resolve(fs.realpathSync(probe), ...remainder);
    this.store = path.join(storageBase, hash(this.root).slice(0, 24));
    let storeStat;
    try { storeStat = fs.lstatSync(this.store); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    if (storeStat?.isSymbolicLink()) {
      try { this.store = fs.realpathSync(this.store); }
      catch (error) {
        if (error.code === 'ENOENT') throw new Error('Snapshot storage symlink target must already exist');
        throw error;
      }
    }
    const relativeStore = path.relative(this.root, this.store);
    if (!relativeStore || (relativeStore !== '..' && !relativeStore.startsWith('..' + path.sep) && !path.isAbsolute(relativeStore))) throw new Error('Snapshot storage must be outside the recorded repository');
    const directories = ['blobs', 'checkpoints', 'operations', 'worktrees', 'gaps', 'recovery', 'fixture-runs'];
    fs.mkdirSync(this.store, { recursive: true, mode: 0o700 });
    // Validate every existing child before creating any of them. In particular,
    // a symlinked blob directory must not redirect immutable snapshots into a
    // project (or another caller-controlled directory).
    const existing = new Set();
    for (const dir of directories) {
      const child = path.join(this.store, dir);
      try {
        const stat = fs.lstatSync(child);
        if (stat.isSymbolicLink() || !stat.isDirectory()) throw new Error(`Snapshot storage directory must be a real directory: ${child}`);
        existing.add(dir);
      } catch (error) { if (error.code !== 'ENOENT') throw error; }
    }
    for (const dir of directories) if (!existing.has(dir)) fs.mkdirSync(path.join(this.store, dir), { mode: 0o700 });
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
        this.writeBlob(file.bytes, file.hash);
        files[name] = { hash: file.hash, mode: file.mode };
      }
      const checkpointId = crypto.randomUUID();
      const capturedEvent = event?.contract === 'chronicle.adapter-event' && event.contractVersion === 1
        ? { ...event, references: { ...event.references, snapshotId: checkpointId, gapId: null } }
        : event;
      const checkpoint = { schema: 1, id: checkpointId, label: String(label).slice(0, 200), createdAt: new Date().toISOString(), root: this.root, head, files, tracked: first.tracked, excluded: first.excluded, event: capturedEvent };
      // Index evidence is separate; no command stages or resets the original index.
      checkpoint.index = index;
      writeJson(path.join(this.store, 'checkpoints', checkpoint.id + '.json'), checkpoint);
      return checkpoint;
    });
  }

  list() {
    return fs.readdirSync(path.join(this.store, 'checkpoints')).filter(n => n.endsWith('.json')).map(n => JSON.parse(fs.readFileSync(path.join(this.store, 'checkpoints', n), 'utf8'))).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }

  gaps(from, to) {
    const checkpoints = from && to ? [this.checkpoint(from), this.checkpoint(to)] : [];
    const start = checkpoints.length ? Math.min(...checkpoints.map(cp => Date.parse(cp.createdAt))) : -Infinity;
    const end = checkpoints.length ? Math.max(...checkpoints.map(cp => Date.parse(cp.createdAt))) : Infinity;
    return fs.readdirSync(path.join(this.store, 'gaps')).filter(name => name.endsWith('.json')).map(name => JSON.parse(fs.readFileSync(path.join(this.store, 'gaps', name), 'utf8'))).filter(item => item.kind === 'capture-gap' ? Date.parse(item.createdAt) >= start && Date.parse(item.createdAt) <= end : true).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }

  recordGap(event, error) {
    const dir = path.join(this.store, 'gaps');
    const entries = fs.readdirSync(dir);
    if (entries.length >= 1000) {
      const limit = path.join(dir, 'limit-reached.json');
      if (!fs.existsSync(limit)) writeJson(limit, { schema: 1, kind: 'capture-gap-limit', createdAt: new Date().toISOString(), message: 'Capture-gap history reached its 1000-event limit; later gaps may not be recorded.' });
      return;
    }
    const detail = String(error?.message || '');
    const reason = /busy|operation\.lock/i.test(detail) ? 'RECORDER_BUSY' : /workspace changed/i.test(detail) ? 'WORKSPACE_CHANGED' : /exceed/i.test(detail) ? 'CAPTURE_LIMIT' : /excluded|unsupported|binary|symlink/i.test(detail) ? 'UNSUPPORTED_FILE' : /not a git|repository|rev-parse/i.test(detail) ? 'REPOSITORY_ERROR' : 'CAPTURE_FAILED';
    const clean = value => typeof value === 'string' ? value.slice(0, 200) : undefined;
    const gapId = crypto.randomUUID();
    const gapEvent = event?.contract === 'chronicle.adapter-event' && event.contractVersion === 1
      ? { ...event, references: { ...event.references, snapshotId: null, gapId } }
      : undefined;
    const gap = {
      schema: 1, kind: 'capture-gap', id: gapId, repoId: hash(this.root), createdAt: new Date().toISOString(),
      status: 'skipped', reason, source: event.source === 'codex-cli' ? 'codex-cli' : 'claude-code', boundary: clean(event.boundary), sessionId: clean(event.sessionId), toolUseId: clean(event.toolUseId), tool: clean(event.tool),
      ...(gapEvent ? { event: gapEvent } : {})
    };
    writeJson(path.join(dir, gap.id + '.json'), gap);
    return gap;
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

  writeBlob(bytes, digest) {
    const target = path.join(this.store, 'blobs', digest);
    try {
      const existing = fs.readFileSync(target);
      if (hash(existing) !== digest) throw new Error('Existing blob is damaged; checkpoint was not saved');
      return;
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
    // Publish a fully written and fsynced blob atomically. A crash can leave only an
    // unreferenced temporary file; it cannot poison the permanent content hash.
    const temp = target + '.' + crypto.randomUUID() + '.tmp';
    const fd = fs.openSync(temp, 'wx', 0o600);
    try { fs.writeFileSync(fd, bytes); fs.fsyncSync(fd); }
    finally { fs.closeSync(fd); }
    try { fs.linkSync(temp, target); }
    catch (error) { if (error.code !== 'EEXIST') throw error; }
    finally { try { fs.unlinkSync(temp); } catch (error) { if (error.code !== 'ENOENT') throw error; } }
    if (hash(fs.readFileSync(target)) !== digest) throw new Error('Snapshot integrity check failed after writing blob');
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
          // The parser requires plain headers and a prefix on every context row,
          // including blank lines, regardless of the user's global Git settings.
          const patch = git(temp, ['-c', 'diff.suppressBlankEmpty=false', 'diff', '--no-color', '--no-index', '--no-ext-diff', '--no-textconv', '--text', '--unified=3', '--', 'before', 'after'], [0, 1]);
          const headers = [...patch.matchAll(/^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@.*$/gm)];
          if (!headers.length) throw new Error('Unable to parse the saved file diff; selection refused');
          hunks = headers.map((h, i) => {
            const oldCount = h[2] === undefined ? 1 : Number(h[2]), newCount = h[4] === undefined ? 1 : Number(h[4]);
            return { id: fileId + ':' + i, oldStart: Number(h[1]) - (oldCount ? 1 : 0), oldCount, newStart: Number(h[3]) - (newCount ? 1 : 0), newCount, patch: patch.slice(h.index, headers[i + 1]?.index || patch.length) };
          });
          hunks = hunks.map(hunk => ({ ...hunk, groups: changeGroups(hunk) }));
        } finally { fs.rmSync(temp, { recursive: true, force: true }); }
      }
      changes.push({ path: name, type: !a ? 'added' : !b ? 'deleted' : 'modified', hunks });
    }
    return { from, to, changes, excluded: [...before.excluded, ...after.excluded], gaps: this.gaps(from, to), modelRequests: 0 };
  }

  preview(from, to, selected) {
    if (!Array.isArray(selected) || selected.some(id => typeof id !== 'string')) throw new Error('Selection must be a list of hunk IDs');
    const diff = this.compare(from, to), chosen = new Set(selected);
    const known = new Set(diff.changes.flatMap(f => f.hunks.flatMap(h => [h.id, ...(h.groups || []).map(group => group.id)])));
    for (const id of chosen) if (!known.has(id)) throw new Error('Stale or invalid selection');
    const before = this.checkpoint(from), after = this.checkpoint(to), result = [];
    for (const change of diff.changes) {
      const hunks = change.hunks.filter(h => chosen.has(h.id));
      const groups = change.hunks.flatMap(h => (h.groups || []).filter(group => chosen.has(h.id) || chosen.has(group.id)));
      if (!hunks.length && !groups.length) continue;
      const oldLines = lines(text(this.bytes(before.files[change.path]))), newLines = lines(text(this.bytes(after.files[change.path])));
      let content;
      if (hunks[0]?.wholeFile) content = after.files[change.path] ? text(this.bytes(after.files[change.path])) : null;
      else {
        const output = []; let cursor = 0;
        for (const group of groups.sort((a, b) => a.oldStart - b.oldStart || a.newStart - b.newStart)) {
          if (group.oldStart < cursor) throw new Error('Overlapping selection');
          output.push(...oldLines.slice(cursor, group.oldStart), ...newLines.slice(group.newStart, group.newStart + group.newCount));
          cursor = group.oldStart + group.oldCount;
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
      const op = { id, from, to, selected, branch, target, head: baseline.head, state: 'prepared', createdAt: new Date().toISOString(), modelRequests: 0 };
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
        op.state = 'completed';
        op.files = [...expected].map(([name, file]) => ({ path: name, hash: hash(file.bytes) }));
        op.deletedPaths = [...new Set(headFiles.filter(name => !expected.has(name)))];
        const source = this.checkpoint(from), result = this.checkpoint(to);
        const intervalGaps = this.gaps(from, to);
        op.manifest = {
          schema: 1,
          checkpoints: { from, to },
          baselineCommit: baseline.head,
          selectedChangeIds: [...selected],
          host: { source: result.event?.source || 'unknown', attribution: result.event?.attribution || 'unknown' },
          captureCoverage: {
            excludedFiles: source.excluded.length + result.excluded.length,
            gaps: intervalGaps.length,
            boundaries: [source.event?.boundary, result.event?.boundary].filter(Boolean)
          },
          environment: { node: process.version, platform: process.platform, architecture: process.arch },
          outputFiles: op.files.map(file => ({ ...file, mode: expected.get(file.path).mode })),
          checks: [],
          reportedCost: null
        };
        writeJson(journal, op);
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

  beginFixtureRun(cassette, sourceCheckpointId) {
    const source = this.checkpoint(sourceCheckpointId);
    const id = crypto.randomUUID();
    const file = path.join(this.store, 'fixture-runs', id + '.json');
    const run = {
      schema: 1, kind: 'chronicle.fixture-run', id,
      fixtureId: cassette.fixtureId, cassetteHash: hash(Buffer.from(JSON.stringify(cassette), 'utf8')),
      source: { checkpoint: sourceCheckpointId, commit: source.head },
      events: [], outcome: null, candidateOperationId: null, binding: null
    };
    const server = createSimulatedReplayMcp(cassette, {
      onEvidence: evidence => this.exclusive(() => {
        if (run.outcome || run.events.length >= 257) throw new Error('Fixture evidence limit reached or run already ended');
        run.events.push({ ...evidence, runId: id, cassetteHash: run.cassetteHash, sequence: run.events.length + 1 });
        writeJson(file, run);
      })
    });
    this.exclusive(() => writeJson(file, run));
    return Object.freeze({
      id, server: Object.freeze({ handle: message => {
        if (run.outcome) throw new Error('Fixture run already ended');
        return server.handle(message);
      } }),
      createBranch: (to, selected, branch) => {
        if (run.outcome?.status !== 'complete') throw new Error('Complete fixture replay before creating a candidate branch');
        if (run.candidateOperationId) throw new Error('Fixture run already has a candidate operation');
        const operation = this.createBranch(sourceCheckpointId, to, selected, branch);
        this.exclusive(() => {
          run.candidateOperationId = operation.id;
          writeJson(file, run);
        });
        return operation;
      },
      finish: () => this.exclusive(() => {
        if (run.outcome) throw new Error('Fixture run already ended');
        try {
          const result = server.finish();
          run.outcome = { status: 'complete', consumedCalls: result.consumedCalls };
        } catch (error) {
          run.outcome = { status: 'failed', code: error.code || 'SIMULATED_REPLAY_ERROR' };
        }
        writeJson(file, run);
        return run.outcome;
      })
    });
  }

  async runFixtureSubprocess(cassette, sourceCheckpointId, messages) {
    const source = this.checkpoint(sourceCheckpointId);
    const serialized = JSON.stringify(cassette);
    const pinned = JSON.parse(serialized);
    createSimulatedReplayMcp(pinned);
    if (!Array.isArray(messages) || messages.length > 260) throw new Error('Fixture request limit exceeded');
    const input = messages.map(message => {
      const line = JSON.stringify(message);
      if (!line || Buffer.byteLength(line) > 64 * 1024) throw new Error('Fixture request exceeds MCP message limit');
      return line + '\n';
    }).join('');
    const id = crypto.randomUUID();
    const folder = path.join(this.store, 'fixture-runs');
    const file = path.join(folder, id + '.json');
    const cassetteFile = path.join(folder, id + '.cassette.json');
    const launchFile = path.join(folder, id + '.launch.json');
    const run = {
      schema: 1, kind: 'chronicle.fixture-run', id, transport: 'stdio-subprocess',
      fixtureId: pinned.fixtureId, cassetteHash: hash(Buffer.from(serialized, 'utf8')),
      source: { checkpoint: sourceCheckpointId, commit: source.head },
      events: [], outcome: null, candidateOperationId: null, binding: null,
      controllerPid: process.pid, childPid: null, launchPhase: 'prepared'
    };
    this.exclusive(() => {
      fs.writeFileSync(cassetteFile, serialized, { flag: 'wx' });
      writeJson(file, run);
    });
    this.exclusive(() => {
      run.launchPhase = 'spawning';
      writeJson(file, run);
    });
    const child = spawn(process.execPath, [path.join(__dirname, '..', 'scripts', 'simulated-replay-mcp.js'), cassetteFile, launchFile, id],
      { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
    if (Number.isSafeInteger(child.pid) && child.pid > 0) this.exclusive(() => {
      run.childPid = child.pid;
      run.launchPhase = 'child-recorded';
      writeJson(file, run);
    });
    let stderr = '', stdout = '', failure = null, timedOut = false;
    const timer = setTimeout(() => { timedOut = true; child.kill(); }, 10000);
    child.stdout.on('data', chunk => {
      stdout += chunk.toString('utf8');
      if (Buffer.byteLength(stdout) > 1024 * 1024) { failure = 'MCP_OUTPUT_LIMIT'; child.kill(); }
    });
    child.stderr.on('data', chunk => {
      stderr += chunk.toString('utf8');
      if (Buffer.byteLength(stderr) > 64 * 1024) { failure = 'MCP_EVIDENCE_LIMIT'; child.kill(); return; }
      let newline;
      while ((newline = stderr.indexOf('\n')) !== -1) {
        const line = stderr.slice(0, newline); stderr = stderr.slice(newline + 1);
        if (!line.startsWith('Chronicle replay evidence ')) continue;
        try {
          const evidence = JSON.parse(line.slice('Chronicle replay evidence '.length));
          this.exclusive(() => {
            if (run.events.length >= 257) throw new Error('Fixture evidence limit reached');
            run.events.push({ ...evidence, runId: id, cassetteHash: run.cassetteHash, sequence: run.events.length + 1 });
            writeJson(file, run);
          });
        } catch { failure = 'MCP_EVIDENCE_INVALID'; child.kill(); }
      }
    });
    child.on('error', () => { failure = 'MCP_PROCESS_ERROR'; });
    child.stdin.on('error', () => { failure = 'MCP_INPUT_ERROR'; child.kill(); });
    child.stdin.end(input);
    const { code, signal } = await new Promise(resolve => child.on('close', (code, signal) => resolve({ code, signal })));
    clearTimeout(timer);
    this.exclusive(() => {
      run.processExit = { code, signal };
      run.outcome = !failure && !timedOut && code === 0 &&
        run.events.length === pinned.calls.length && run.events.every(event => event.kind === 'injected-fixture')
        ? { status: 'complete', consumedCalls: run.events.length }
        : { status: 'failed', code: failure || (timedOut ? 'MCP_PROCESS_TIMEOUT' : 'MCP_PROCESS_INCOMPLETE') };
      writeJson(file, run);
    });
    return Object.freeze({
      id, outcome: run.outcome, responses: stdout.trim().split('\n').filter(Boolean).map(line => JSON.parse(line)),
      createBranch: (to, selected, branch) => {
        if (run.outcome.status !== 'complete' || run.candidateOperationId) throw new Error('Fixture process is incomplete or already has a candidate');
        const operation = this.createBranch(sourceCheckpointId, to, selected, branch);
        this.exclusive(() => { run.candidateOperationId = operation.id; writeJson(file, run); });
        return operation;
      }
    });
  }

  bindFixtureRun(runId, operationId) {
    return this.exclusive(() => {
      if (!/^[a-f0-9-]{36}$/.test(runId) || !/^[a-f0-9-]{36}$/.test(operationId)) throw new Error('Invalid fixture run or operation ID');
      const folder = path.join(this.store, 'fixture-runs');
      const file = path.join(folder, runId + '.json');
      if (fs.readdirSync(folder).some(name => new RegExp('^' + runId + '\\.json\\.[a-f0-9-]{36}\\.tmp$').test(name))) {
        throw new Error('Fixture run has an interrupted journal replacement; inspect it before binding');
      }
      const run = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (run.id !== runId || run.kind !== 'chronicle.fixture-run' || run.schema !== 1 ||
          run.outcome?.status !== 'complete' || run.binding || run.candidateOperationId !== operationId || !Array.isArray(run.events) ||
          run.events.length !== run.outcome.consumedCalls ||
          run.events.some((event, index) => event.sequence !== index + 1 || event.runId !== runId ||
            event.cassetteHash !== run.cassetteHash || event.kind !== 'injected-fixture' || event.fixtureId !== run.fixtureId ||
            !/^[a-f0-9]{64}$/.test(event.requestHash) || !/^[a-f0-9]{64}$/.test(event.responseHash))) {
        throw new Error('Fixture run is incomplete, rejected, already bound, or unrelated to this operation');
      }
      if (run.transport === 'stdio-subprocess') {
        const cassetteFile = path.join(folder, runId + '.cassette.json');
        let cassetteBytes;
        try {
          const stat = fs.lstatSync(cassetteFile);
          if (!stat.isFile() || stat.size > 1024 * 1024) throw new Error('Invalid cassette file');
          cassetteBytes = fs.readFileSync(cassetteFile);
        } catch {
          throw new Error('Fixture cassette is unavailable or invalid; binding refused');
        }
        if (!/^[a-f0-9]{64}$/.test(run.cassetteHash) || hash(cassetteBytes) !== run.cassetteHash) {
          throw new Error('Fixture cassette differs from the pinned run; binding refused');
        }
      }
      for (const name of fs.readdirSync(folder).filter(name => name.endsWith('.json'))) {
        if (name === runId + '.json') continue;
        const other = JSON.parse(fs.readFileSync(path.join(folder, name), 'utf8'));
        if (other.binding?.operationId === operationId) throw new Error('Operation already has fixture evidence');
      }
      const op = JSON.parse(fs.readFileSync(path.join(this.store, 'operations', operationId + '.json'), 'utf8'));
      if (op.id !== operationId || op.state !== 'completed' || op.from !== run.source.checkpoint ||
          op.head !== run.source.commit || op.manifest?.baselineCommit !== run.source.commit ||
          op.manifest?.checkpoints?.from !== run.source.checkpoint ||
          !Array.isArray(op.manifest.outputFiles) || op.manifest.outputFiles.length !== op.files?.length ||
          op.manifest.outputFiles.some(file => !op.files.some(saved => saved.path === file.path && saved.hash === file.hash)) ||
          this.reconcileOperations().find(item => item.id === operationId)?.assessment !== 'completed') {
        throw new Error('Operation source or output is stale; fixture binding refused');
      }
      run.binding = { operationId, manifestHash: hash(Buffer.from(JSON.stringify(op.manifest), 'utf8')) };
      writeJson(file, run);
      return run.binding;
    });
  }

  recoverFixtureRuns() {
    return this.exclusive(() => {
      const folder = path.join(this.store, 'fixture-runs');
      const results = [];
      const entries = fs.readdirSync(folder);
      const replacements = new Set(entries.filter(name => /^[a-f0-9-]{36}\.json\.[a-f0-9-]{36}\.tmp$/.test(name))
        .map(name => name.slice(0, 41)));
      const isDead = pid => {
        if (!Number.isSafeInteger(pid) || pid <= 0) return false;
        try { process.kill(pid, 0); return false; }
        catch (error) { return error.code === 'ESRCH'; }
      };
      for (const name of entries.filter(name => /^[a-f0-9-]{36}\.json$/.test(name))) {
        const file = path.join(folder, name);
        let run;
        try { run = JSON.parse(fs.readFileSync(file, 'utf8')); }
        catch { results.push({ id: name.slice(0, -5), assessment: 'unreadable-record' }); continue; }
        if (replacements.delete(name)) {
          results.push({ id: name.slice(0, -5), assessment: 'replacement-inspect' });
          continue;
        }
        if (run.id !== name.slice(0, -5) || run.schema !== 1 || run.kind !== 'chronicle.fixture-run' ||
            run.transport !== 'stdio-subprocess' || run.outcome !== null) continue;
        let childPid = run.childPid;
        const launchFile = path.join(folder, run.id + '.launch.json');
        let launchWitness = false;
        let witnessPid = null;
        let witnessStat;
        try { witnessStat = fs.lstatSync(launchFile); launchWitness = true; }
        catch (error) { if (error.code !== 'ENOENT') launchWitness = true; }
        // A redirected or oversized witness is ambiguous evidence; do not read it.
        if (launchWitness && witnessStat?.isFile() && witnessStat.size <= 512) {
          try {
            const witness = JSON.parse(fs.readFileSync(launchFile, 'utf8'));
            if (witness.runId === run.id && Number.isSafeInteger(witness.pid) && witness.pid > 0) witnessPid = witness.pid;
          } catch { /* An unreadable launch witness requires inspection. */ }
        }
        if (launchWitness && (witnessPid === null || (childPid !== null && witnessPid !== childPid))) {
          results.push({ id: run.id, assessment: 'pending-inspect' });
          continue;
        }
        if (childPid === null) childPid = witnessPid;
        const childAbsent = (run.launchPhase === 'prepared' && run.childPid === null && !launchWitness) || isDead(childPid);
        if (run.candidateOperationId || run.binding || !isDead(run.controllerPid) || !childAbsent) {
          results.push({ id: run.id, assessment: 'pending-inspect' });
          continue;
        }
        run.outcome = { status: 'failed', code: 'MCP_PROCESS_INTERRUPTED' };
        writeJson(file, run);
        results.push({ id: run.id, assessment: 'interrupted-recorded' });
      }
      for (const name of replacements) results.push({ id: name.slice(0, -5), assessment: 'replacement-inspect' });
      return results;
    });
  }

  recordCheck(operationId, label, exitCode) {
    return this.exclusive(() => {
      if (typeof operationId !== 'string' || !/^[a-f0-9-]{36}$/.test(operationId)) throw new Error('Invalid operation ID');
      if (typeof label !== 'string' || !label.trim() || label.length > 120 || /[\r\n\0]/.test(label)) throw new Error('Check label must be 1–120 characters on one line');
      if (!Number.isInteger(exitCode) || exitCode < 0 || exitCode > 255) throw new Error('Exit code must be an integer from 0 to 255');
      const journal = path.join(this.store, 'operations', operationId + '.json');
      const operation = JSON.parse(fs.readFileSync(journal, 'utf8'));
      if (operation.id !== operationId || operation.state !== 'completed' || operation.manifest?.schema !== 1 || !Array.isArray(operation.manifest.checks)) throw new Error('Check evidence can only be recorded for a completed manifest-backed operation');
      if (operation.manifest.checks.length >= 100) throw new Error('Check evidence limit reached for this operation');
      const check = { id: crypto.randomUUID(), label: label.trim(), exitCode, outcome: exitCode === 0 ? 'reported-pass' : 'reported-fail', source: 'user-reported', recordedAt: new Date().toISOString() };
      operation.manifest.checks.push(check);
      writeJson(journal, operation);
      return check;
    });
  }

  compareOperations(firstId, secondId) {
    if (firstId === secondId) throw new Error('Choose two different operations to compare');
    const read = id => {
      if (typeof id !== 'string' || !/^[a-f0-9-]{36}$/.test(id)) throw new Error('Invalid operation ID');
      const operation = JSON.parse(fs.readFileSync(path.join(this.store, 'operations', id + '.json'), 'utf8'));
      if (operation.id !== id || operation.state !== 'completed' || !operation.manifest || operation.manifest.schema !== 1) throw new Error('Operation has no completed comparison manifest');
      return operation;
    };
    const first = read(firstId), second = read(secondId);
    const fixtureEvidence = operation => {
      const folder = path.join(this.store, 'fixture-runs');
      const checks = operation.manifest.checks;
      if (!Array.isArray(checks) || checks.length > 100) return null;
      const manifestHashes = new Set();
      for (let count = 0; count <= checks.length; count++) {
        const manifest = { ...operation.manifest, checks: checks.slice(0, count) };
        manifestHashes.add(hash(Buffer.from(JSON.stringify(manifest), 'utf8')));
      }
      const entries = fs.readdirSync(folder);
      const matches = [];
      for (const name of entries.filter(name => /^[a-f0-9-]{36}\.json$/.test(name))) {
        let run;
        try {
          const file = path.join(folder, name);
          const stat = fs.lstatSync(file);
          if (!stat.isFile() || stat.size > 1024 * 1024) continue;
          run = JSON.parse(fs.readFileSync(file, 'utf8'));
        }
        catch { continue; }
        if (run.binding?.operationId !== operation.id) continue;
        if (run.transport === 'stdio-subprocess') {
          try {
            const cassetteFile = path.join(folder, name.slice(0, -5) + '.cassette.json');
            const stat = fs.lstatSync(cassetteFile);
            if (!stat.isFile() || stat.size > 1024 * 1024 ||
                hash(fs.readFileSync(cassetteFile)) !== run.cassetteHash) return null;
          } catch { return null; }
        }
        if (entries.some(entry => entry.startsWith(name + '.') && /^[a-f0-9-]{36}\.tmp$/.test(entry.slice(name.length + 1))) ||
            run.id !== name.slice(0, -5) || run.kind !== 'chronicle.fixture-run' || run.schema !== 1 ||
            !manifestHashes.has(run.binding.manifestHash) || run.candidateOperationId !== operation.id ||
            run.outcome?.status !== 'complete' || !Array.isArray(run.events) ||
            run.events.length !== run.outcome.consumedCalls ||
            run.events.some((event, index) => event.kind !== 'injected-fixture' || event.sequence !== index + 1 ||
              event.runId !== run.id || event.cassetteHash !== run.cassetteHash || event.fixtureId !== run.fixtureId ||
              !/^[a-f0-9]{64}$/.test(event.requestHash) || !/^[a-f0-9]{64}$/.test(event.responseHash))) return null;
        matches.push({ runId: run.id, injectedFixtureCalls: run.events.length, rejectedFixtureCalls: 0, liveToolCalls: null });
      }
      return matches.length === 1 ? matches[0] : null;
    };
    const files = new Map();
    for (const [side, operation] of [['first', first], ['second', second]]) for (const file of operation.manifest.outputFiles) {
      const previous = files.get(file.path) || { path: file.path, first: null, second: null };
      previous[side] = { hash: file.hash, mode: file.mode };
      files.set(file.path, previous);
    }
    const comparisons = [...files.values()].sort((a, b) => a.path.localeCompare(b.path)).map(file => ({
      ...file,
      status: !file.first ? 'added' : !file.second ? 'deleted' : file.first.hash === file.second.hash && file.first.mode === file.second.mode ? 'identical' : 'changed'
    }));
    return { first: { id: first.id, branch: first.branch, manifest: first.manifest, fixtureEvidence: fixtureEvidence(first) }, second: { id: second.id, branch: second.branch, manifest: second.manifest, fixtureEvidence: fixtureEvidence(second) }, files: comparisons, modelRequests: 0 };
  }

  undoOperation(id) {
    return this.exclusive(() => {
      if (typeof id !== 'string' || !/^[a-f0-9-]{36}$/.test(id)) throw new Error('Invalid operation ID');
      const journal = path.join(this.store, 'operations', id + '.json');
      const op = JSON.parse(fs.readFileSync(journal, 'utf8'));
      const target = path.resolve(this.store, 'worktrees', id);
      if (op.id !== id || path.resolve(op.target || '') !== target) throw new Error('Operation target is invalid');
      if (!['completed', 'undoing'].includes(op.state)) throw new Error('Only a completed Chronicle operation can be undone');
      if (git(target, ['rev-parse', 'HEAD']).trim() !== op.head) throw new Error('Output branch has new commits; undo refused');
      const branchRef = 'refs/heads/' + op.branch;
      if (!git(target, ['symbolic-ref', 'HEAD']).trim().endsWith('/' + op.branch) || !git(this.root, ['show-ref', '--verify', '--hash', branchRef], [0, 1]).trim()) throw new Error('Output branch identity changed; undo refused');

      const registrations = git(this.root, ['worktree', 'list', '--porcelain']).split(/\r?\n\r?\n/).filter(Boolean);
      const registered = registrations.some(record => {
        const worktree = record.split(/\r?\n/).find(line => line.startsWith('worktree '));
        const branch = record.split(/\r?\n/).find(line => line.startsWith('branch '));
        return worktree && path.resolve(worktree.slice(9)) === target && branch?.slice(7) === branchRef;
      });
      if (!registered || !fs.statSync(target).isDirectory()) throw new Error('Chronicle output worktree is unavailable; undo refused');

      const preview = this.preview(op.from, op.to, op.selected);
      if (!Array.isArray(op.files) || !Array.isArray(op.deletedPaths)) throw new Error('Operation has no verified output manifest; undo refused');
      const manifest = new Map(op.files.map(file => [file.path, file.hash]));
      if (manifest.size !== op.files.length || preview.files.some(file => file.content !== null && manifest.get(file.path) !== hash(Buffer.from(file.content, 'utf8')))) throw new Error('Operation manifest does not match its selection; undo refused');
      const staged = new Set(git(target, ['diff', '--cached', '--name-only', '-z']).split('\0').filter(Boolean));
      const baseline = this.checkpoint(op.from);
      const plan = preview.files.map(file => {
        if (staged.has(file.path)) throw new Error('Selected output path has staged changes; undo refused: ' + file.path);
        const full = safePath(target, file.path);
        const original = baseline.files[file.path];
        let current = null;
        try {
          const stat = fs.lstatSync(full);
          if (!stat.isFile()) throw new Error('Selected output path is no longer a regular file; undo refused: ' + file.path);
          current = { bytes: fs.readFileSync(full), mode: process.platform === 'win32' ? (original?.mode || file.mode) : stat.mode & 0o111 ? '100755' : '100644' };
        } catch (error) { if (error.code !== 'ENOENT') throw error; }
        const expected = file.content === null ? null : { bytes: Buffer.from(file.content, 'utf8'), mode: file.mode };
        const prior = original ? { bytes: this.bytes(original), mode: original.mode } : null;
        const matches = (actual, state) => state === null ? actual === null : actual !== null && actual.bytes.equals(state.bytes) && actual.mode === state.mode;
        const canContinue = matches(current, expected) || (op.state === 'undoing' && matches(current, prior));
        if (!canContinue) throw new Error('Selected output changed after Chronicle created it; undo refused: ' + file.path);
        return { file, full, prior, expected, matches };
      });

      if (op.state === 'completed') { op.state = 'undoing'; op.undoStartedAt = new Date().toISOString(); writeJson(journal, op); }
      for (const item of plan) {
        if (git(target, ['rev-parse', 'HEAD']).trim() !== op.head) throw new Error('Output branch gained a commit during undo; recovery journal retained');
        if (git(target, ['diff', '--cached', '--name-only', '-z']).split('\0').includes(item.file.path)) throw new Error('Selected output path was staged during undo; recovery journal retained: ' + item.file.path);
        let current = null;
        try {
          const stat = fs.lstatSync(item.full);
          if (!stat.isFile()) throw new Error('Selected output path is no longer a regular file; recovery journal retained: ' + item.file.path);
          current = { bytes: fs.readFileSync(item.full), mode: process.platform === 'win32' ? (item.prior?.mode || item.file.mode) : stat.mode & 0o111 ? '100755' : '100644' };
        } catch (error) { if (error.code !== 'ENOENT') throw error; }
        if (item.matches(current, item.prior)) continue;
        if (!item.matches(current, item.expected)) throw new Error('Selected output changed during undo; recovery journal retained: ' + item.file.path);
        if (item.prior === null) fs.unlinkSync(item.full);
        else {
          fs.mkdirSync(path.dirname(item.full), { recursive: true });
          const temp = item.full + '.chronicle-undo-' + crypto.randomUUID() + '.tmp';
          const fd = fs.openSync(temp, 'wx', 0o600);
          try {
            fs.writeFileSync(fd, item.prior.bytes);
            if (process.platform !== 'win32') fs.fchmodSync(fd, item.prior.mode === '100755' ? 0o755 : 0o644);
            fs.fsyncSync(fd);
          } finally { fs.closeSync(fd); }
          if (hash(fs.readFileSync(temp)) !== hash(item.prior.bytes)) throw new Error('Undo verification failed before replacement: ' + item.file.path);
          // A crash before rename leaves the original selected file intact. A rename
          // publishes the fully written baseline atomically on the same filesystem.
          fs.renameSync(temp, item.full);
          if (hash(fs.readFileSync(item.full)) !== hash(item.prior.bytes)) throw new Error('Undo verification failed: ' + item.file.path);
        }
      }
      op.state = 'undone'; op.undoneAt = new Date().toISOString(); writeJson(journal, op);
      return { id, state: op.state, target, restoredPaths: plan.map(item => item.file.path), modelRequests: 0 };
    });
  }

  reconcileOperations() {
    const worktrees = new Map();
    const records = git(this.root, ['worktree', 'list', '--porcelain']).split(/\r?\n\r?\n/).filter(Boolean);
    for (const record of records) {
      const fields = Object.fromEntries(record.split(/\r?\n/).map(line => {
        const space = line.indexOf(' '); return space < 0 ? [line, true] : [line.slice(0, space), line.slice(space + 1)];
      }));
      if (typeof fields.worktree === 'string') worktrees.set(path.resolve(fields.worktree), fields);
    }
    return this.operations().map(operation => {
      const expectedTarget = path.resolve(this.store, 'worktrees', operation.id);
      if (!/^[a-f0-9-]{36}$/.test(operation.id || '') || path.resolve(operation.target || '') !== expectedTarget) {
        return { id: operation.id, branch: operation.branch, recordedState: operation.state, assessment: 'invalid-journal-target', target: operation.target, worktreeRegistered: false, branchExists: false, dirty: null };
      }
      const registration = worktrees.get(expectedTarget);
      const targetExists = fs.existsSync(expectedTarget);
      const branchRef = 'refs/heads/' + operation.branch;
      const branchExists = Boolean(git(this.root, ['show-ref', '--verify', '--hash', branchRef], [0, 1]).trim());
      let dirty = null, modifiedSinceCompletion = null;
      if (registration && targetExists) {
        dirty = git(expectedTarget, ['status', '--porcelain=v1', '-z', '--untracked-files=all']).length > 0;
        if (operation.state === 'completed') {
          if (Array.isArray(operation.files) && Array.isArray(operation.deletedPaths) && typeof operation.head === 'string') {
            const expected = new Map(operation.files.map(file => [file.path, file.hash]));
            const absent = new Set(operation.deletedPaths);
            modifiedSinceCompletion = git(expectedTarget, ['rev-parse', 'HEAD']).trim() !== operation.head;
            for (const [name, digest] of expected) {
              try {
                const full = safePath(expectedTarget, name);
                if (!fs.lstatSync(full).isFile() || hash(fs.readFileSync(full)) !== digest) modifiedSinceCompletion = true;
              } catch { modifiedSinceCompletion = true; }
            }
            for (const name of absent) {
              try { if (fs.lstatSync(safePath(expectedTarget, name))) modifiedSinceCompletion = true; }
              catch (error) { if (error.code !== 'ENOENT') modifiedSinceCompletion = true; }
            }
            const present = git(expectedTarget, ['ls-files', '-z']).split('\0').filter(Boolean);
            for (const name of git(expectedTarget, ['ls-files', '--others', '--exclude-standard', '-z']).split('\0').filter(Boolean)) present.push(name);
            if (present.some(name => !expected.has(name) && !absent.has(name))) modifiedSinceCompletion = true;
          }
        }
      }
      let assessment;
      if (registration && !targetExists) assessment = 'registered-worktree-missing-directory';
      else if (registration && registration.branch !== branchRef) assessment = 'branch-mismatch';
      else if (registration && operation.state === 'applying') assessment = 'interrupted-worktree';
      else if (registration && operation.state === 'prepared') assessment = 'worktree-created-before-journal-update';
      else if (registration && operation.state === 'failed') assessment = 'failed-worktree-retained';
      else if (registration && operation.state === 'undone') assessment = 'operation-undone';
      else if (registration && operation.state === 'completed') assessment = modifiedSinceCompletion === null ? 'completion-unverified' : modifiedSinceCompletion ? 'completed-worktree-modified' : 'completed';
      else if (registration) assessment = 'worktree-present';
      else if (branchExists) assessment = targetExists ? 'target-exists-unregistered' : 'branch-exists-worktree-unavailable';
      else if (targetExists) assessment = 'target-exists-unregistered';
      else assessment = 'not-started-or-fully-removed';
      return { id: operation.id, branch: operation.branch, recordedState: operation.state, assessment, target: operation.target, worktreeRegistered: Boolean(registration), branchExists, dirty, modifiedSinceCompletion };
    });
  }

  recoverStorage(confirmDeadLock = false) {
    const lock = path.join(this.store, 'operation.lock');
    let staleLock;
    try {
      const raw = fs.readFileSync(lock, 'utf8');
      const match = raw.match(/^\s*(\d+)\s*$/);
      const pid = match ? Number(match[1]) : 0;
      if (!pid) throw new Error('operation.lock has no readable process ID. Inspect it manually; Chronicle made no changes.');
      try { process.kill(pid, 0); throw new Error(`Chronicle process ${pid} is still running. Recovery made no changes.`); }
      catch (error) {
        if (error.code !== 'ESRCH') throw error;
      }
      if (!confirmDeadLock) throw new Error(`The lock owner process ${pid} is not running. To preserve it and recover interrupted files, rerun: node "${path.join(__dirname, 'cli.js')}" recover --confirm-stale-lock`);
      staleLock = { file: lock, pid };
    } catch (error) { if (error.code !== 'ENOENT') throw error; }

    let movedLock;
    if (staleLock) {
      const folder = path.join(this.store, 'recovery', crypto.randomUUID()); fs.mkdirSync(folder);
      movedLock = path.join(folder, 'operation.lock');
      fs.renameSync(staleLock.file, movedLock);
    }
    try {
      return this.exclusive(() => {
        const folder = path.join(this.store, 'recovery', crypto.randomUUID()); fs.mkdirSync(folder);
        const quarantined = [];
        for (const dir of ['blobs', 'checkpoints', 'operations']) {
          const source = path.join(this.store, dir);
          for (const name of fs.readdirSync(source).filter(name => name.endsWith('.tmp'))) {
            const from = path.join(source, name), to = path.join(folder, dir + '-' + name);
            fs.renameSync(from, to); quarantined.push({ original: dir + '/' + name, savedAs: to });
          }
        }
        const pendingOperations = this.operations().filter(operation => operation.state !== 'completed');
        return { quarantined, pendingOperations, staleLock: movedLock || null, modelRequests: 0 };
      });
    } catch (error) {
      // The dead lock has already been preserved if a concurrent recorder won the race.
      throw error;
    }
  }
}

module.exports = { Chronicle, git, hash, safePath };
