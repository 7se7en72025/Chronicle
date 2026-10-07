'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { git } = require('../src/engine');

test('unknown CLI commands refuse before repository or storage initialization', t => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'chronicle-cli-'));
  t.after(() => fs.rmSync(base, { recursive: true, force: true }));
  const storage = path.join(base, 'history');
  const run = () => spawnSync(process.execPath, [path.join(__dirname, '..', 'src', 'cli.js'), 'captuer'], {
    cwd: base, encoding: 'utf8', env: { ...process.env, CHRONICLE_HOME: storage }
  });
  for (const repository of [false, true]) {
    if (repository) { git(base, ['init']); git(base, ['-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', 'commit', '--allow-empty', '-m', 'Baseline']); }
    const result = run();
    assert.equal(result.status, 1);
    assert.match(result.stderr, /Unknown command\. Run with --help/);
    assert.equal(fs.existsSync(storage), false);
  }
});
