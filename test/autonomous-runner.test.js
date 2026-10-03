const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const repositoryRoot = path.resolve(__dirname, '..');
const powershell = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');

function git(cwd, ...args) {
  return execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

function makeFixture(t) {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'chronicle runner '));
  const repo = path.join(tempRoot, 'repo');
  const remote = path.join(tempRoot, 'origin.git');
  const scripts = path.join(repo, 'scripts');
  const state = path.join(tempRoot, 'runner state');
  fs.mkdirSync(scripts, { recursive: true });
  fs.mkdirSync(state);
  fs.copyFileSync(path.join(repositoryRoot, 'scripts', 'run-autonomous.ps1'), path.join(scripts, 'run-autonomous.ps1'));
  execFileSync('git', ['init', '--quiet', '--bare', '--initial-branch=main', remote]);
  execFileSync('git', ['init', '--quiet', '--initial-branch', 'main', repo]);
  git(repo, 'config', 'user.name', 'Chronicle Runner Test');
  git(repo, 'config', 'user.email', 'chronicle-runner-test@example.invalid');
  fs.writeFileSync(path.join(repo, 'seed.txt'), 'fixture\n');
  fs.writeFileSync(path.join(repo, 'checks.js'), 'process.exit(0);\n');
  fs.writeFileSync(path.join(repo, 'package.json'), JSON.stringify({ scripts: { test: 'node checks.js', check: 'node checks.js' } }));
  git(repo, 'add', 'seed.txt', 'checks.js', 'package.json', 'scripts/run-autonomous.ps1');
  git(repo, 'commit', '--quiet', '-m', 'seed fixture');
  git(repo, 'remote', 'add', 'origin', remote);
  git(repo, 'push', '--quiet', '--set-upstream', 'origin', 'main');

  const fakeCodex = path.join(tempRoot, 'fake codex.ps1');
  fs.writeFileSync(fakeCodex, [
    "$outIndex = [Array]::IndexOf($args, '--output-last-message')",
    'if ($outIndex -lt 0) { exit 13 }',
    "if ($env:CHRONICLE_AUTONOMOUS_PROMPT -notmatch 'review-and-improve') { exit 14 }",
    "if ($env:CHRONICLE_FAKE_STDERR -eq '1') { & cmd.exe /d /c 'echo harmless diagnostics 1>&2'; if ($LASTEXITCODE -ne 0) { exit 16 } }",
    "if ($env:CHRONICLE_FAKE_EDIT -eq '1') { [System.IO.File]::WriteAllText((Join-Path $env:CHRONICLE_FIXTURE_REPO 'seed.txt'), 'verified fixture') }",
    "if ($env:CHRONICLE_FAKE_UNTRACKED -eq '1') { [System.IO.File]::WriteAllText((Join-Path $env:CHRONICLE_FIXTURE_REPO 'extra.txt'), 'preserve me') }",
    "if ($env:CHRONICLE_FAKE_EDIT_RUNNER -eq '1') { [System.IO.File]::AppendAllText((Join-Path $env:CHRONICLE_FIXTURE_REPO 'scripts/run-autonomous.ps1'), \"`n# modified by fake worker`n\") }",
    "if ($env:CHRONICLE_FAKE_PUSH_URL) { & git -C $env:CHRONICLE_FIXTURE_REPO config remote.origin.pushurl $env:CHRONICLE_FAKE_PUSH_URL; if ($LASTEXITCODE -ne 0) { exit 17 } }",
    "if ($env:CHRONICLE_FAKE_NO_STOP -eq '1') { $summary = 'CHRONICLE_RUNNER_READY Verify fixture edits' } else { $summary = \"CHRONICLE_RUNNER_STOP`nFixture queue complete.\" }",
    '[System.IO.File]::WriteAllText($args[$outIndex + 1], $summary)',
    "if ($env:CHRONICLE_FAKE_NO_EVIDENCE -ne '1') { foreach ($command in @('npm.cmd test', 'npm.cmd run check')) { $code = if ($env:CHRONICLE_FAKE_FAIL_CHECKS -eq '1' -and $command -eq 'npm.cmd test') { 1 } else { 0 }; @{ type = 'item.completed'; item = @{ type = 'command_execution'; command = $command; status = 'completed'; exit_code = $code } } | ConvertTo-Json -Depth 4 -Compress | Write-Output } }",
    "[System.IO.File]::WriteAllText($env:CHRONICLE_FAKE_CODEX_MARKER, ($args -join ' '))",
    'exit 0',
  ].join('\n'));

  t.after(() => fs.rmSync(tempRoot, { recursive: true, force: true }));
  return { repo, remote, state, fakeCodex, tempRoot };
}

function runRunner(fixture) {
  return execFileSync(powershell, [
    '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File',
    path.join(fixture.repo, 'scripts', 'run-autonomous.ps1'), '-Once', '-CodexCommand', fixture.fakeCodex, '-ExpectedOrigin', fixture.remote,
  ], {
    cwd: fixture.repo,
    encoding: 'utf8',
    env: {
      ...process.env,
      CHRONICLE_RUNNER_STATE: fixture.state,
      CHRONICLE_FAKE_CODEX_MARKER: path.join(fixture.tempRoot, 'called.txt'),
      CHRONICLE_FAKE_NO_STOP: fixture.noStop ? '1' : '0',
      CHRONICLE_FAKE_EDIT: fixture.edit ? '1' : '0',
      CHRONICLE_FAKE_UNTRACKED: fixture.untracked ? '1' : '0',
      CHRONICLE_FAKE_FAIL_CHECKS: fixture.failChecks ? '1' : '0',
      CHRONICLE_FAKE_NO_EVIDENCE: fixture.noEvidence ? '1' : '0',
      CHRONICLE_FAKE_EDIT_RUNNER: fixture.editRunner ? '1' : '0',
      CHRONICLE_FAKE_STDERR: fixture.stderr ? '1' : '0',
      CHRONICLE_FAKE_PUSH_URL: fixture.pushUrl || '',
      CHRONICLE_FIXTURE_REPO: fixture.repo,
    },
    timeout: 30_000,
    windowsHide: true,
  });
}

test('autonomous runner and task lifecycle scripts parse on Windows PowerShell', (t) => {
  if (process.platform !== 'win32' || !fs.existsSync(powershell)) return t.skip('Requires Windows PowerShell.');
  const files = [
    'run-autonomous.ps1',
    'install-autonomous-task.ps1',
    'uninstall-autonomous-task.ps1',
  ].map((file) => path.join(repositoryRoot, 'scripts', file));
  const literals = files.map((file) => `'${file.replaceAll("'", "''")}'`).join(',');
  const command = `$files=@(${literals}); foreach($file in $files){$tokens=$null;$errors=$null;[System.Management.Automation.Language.Parser]::ParseFile($file,[ref]$tokens,[ref]$errors)|Out-Null;if($errors.Count){throw ($errors -join ';')}}`;
  execFileSync(powershell, ['-NoProfile', '-NonInteractive', '-Command', command], { encoding: 'utf8', stdio: 'pipe', windowsHide: true });
});

test('autonomous runner invokes one isolated cycle and honors the stop marker', (t) => {
  if (process.platform !== 'win32' || !fs.existsSync(powershell)) return t.skip('Requires Windows PowerShell.');
  const fixture = makeFixture(t);
  runRunner(fixture);

  const marker = fs.readFileSync(path.join(fixture.tempRoot, 'called.txt'), 'utf8');
  assert.match(marker, /network_access=false/);
  assert.match(marker, /--config approval_policy=never/);
  assert.match(fs.readFileSync(path.join(fixture.state, 'STOP'), 'utf8'), /Queue complete/);
  assert.equal(git(fixture.repo, 'status', '--porcelain'), '');
});

test('autonomous runner tolerates native stderr when the Codex cycle succeeds', (t) => {
  if (process.platform !== 'win32' || !fs.existsSync(powershell)) return t.skip('Requires Windows PowerShell.');
  const fixture = makeFixture(t);
  fixture.stderr = true;

  runRunner(fixture);

  assert.match(fs.readFileSync(path.join(fixture.state, 'STOP'), 'utf8'), /Queue complete/);
  const logs = fs.readdirSync(fixture.state).filter((name) => name.endsWith('.jsonl'));
  assert.equal(logs.length, 1);
  assert.match(fs.readFileSync(path.join(fixture.state, logs[0]), 'utf8'), /harmless diagnostics/);
});

test('autonomous runner pauses when a ready cycle makes no tracked edits', (t) => {
  if (process.platform !== 'win32' || !fs.existsSync(powershell)) return t.skip('Requires Windows PowerShell.');
  const fixture = makeFixture(t);
  fixture.noStop = true;

  runRunner(fixture);

  assert.ok(fs.existsSync(path.join(fixture.tempRoot, 'called.txt')));
  assert.match(fs.readFileSync(path.join(fixture.state, 'STOP'), 'utf8'), /No tracked edits/);
  assert.equal(git(fixture.repo, 'rev-parse', 'HEAD'), git(fixture.repo, 'rev-parse', 'refs/remotes/origin/main'));
});

test('autonomous runner verifies tracked edits, commits once, and publishes to origin', (t) => {
  if (process.platform !== 'win32' || !fs.existsSync(powershell)) return t.skip('Requires Windows PowerShell.');
  const fixture = makeFixture(t);
  fixture.noStop = true;
  fixture.edit = true;
  const startingCommit = git(fixture.repo, 'rev-parse', 'HEAD');

  runRunner(fixture);

  assert.notEqual(git(fixture.repo, 'rev-parse', 'HEAD'), startingCommit);
  assert.equal(git(fixture.repo, 'rev-parse', 'HEAD^'), startingCommit);
  assert.equal(fs.readFileSync(path.join(fixture.repo, 'seed.txt'), 'utf8'), 'verified fixture');
  assert.equal(git(fixture.repo, 'log', '-1', '--format=%s'), 'Verify fixture edits');
  assert.equal(git(fixture.repo, 'status', '--porcelain'), '');
  assert.equal(git(fixture.remote, 'rev-parse', 'refs/heads/main'), git(fixture.repo, 'rev-parse', 'HEAD'));
  assert.equal(git(fixture.repo, 'rev-parse', 'refs/remotes/origin/main'), git(fixture.repo, 'rev-parse', 'HEAD'));
  const stopPath = path.join(fixture.state, 'STOP');
  assert.equal(fs.existsSync(stopPath), false, fs.existsSync(stopPath) ? fs.readFileSync(stopPath, 'utf8') : undefined);
});

test('autonomous runner preserves edits when the push destination changes during the cycle', (t) => {
  if (process.platform !== 'win32' || !fs.existsSync(powershell)) return t.skip('Requires Windows PowerShell.');
  const fixture = makeFixture(t);
  const alternateRemote = path.join(fixture.tempRoot, 'alternate.git');
  execFileSync('git', ['init', '--quiet', '--bare', '--initial-branch=main', alternateRemote]);
  fixture.noStop = true;
  fixture.edit = true;
  fixture.pushUrl = alternateRemote;
  const startingCommit = git(fixture.repo, 'rev-parse', 'HEAD');

  runRunner(fixture);

  assert.equal(git(fixture.repo, 'rev-parse', 'HEAD'), startingCommit);
  assert.equal(git(fixture.remote, 'rev-parse', 'refs/heads/main'), startingCommit);
  assert.equal(fs.existsSync(path.join(alternateRemote, 'refs', 'heads', 'main')), false);
  assert.equal(git(fixture.repo, 'rev-parse', 'refs/remotes/origin/main'), startingCommit);
  assert.match(git(fixture.repo, 'status', '--porcelain'), /^M seed\.txt/);
  assert.match(fs.readFileSync(path.join(fixture.state, 'STOP'), 'utf8'), /Push origin changed/);
  assert.equal(git(fixture.repo, 'remote', 'get-url', '--push', 'origin'), alternateRemote);
});

test('autonomous runner preserves untracked output without staging or publishing it', (t) => {
  if (process.platform !== 'win32' || !fs.existsSync(powershell)) return t.skip('Requires Windows PowerShell.');
  const fixture = makeFixture(t);
  fixture.noStop = true;
  fixture.edit = true;
  fixture.untracked = true;
  const startingCommit = git(fixture.repo, 'rev-parse', 'HEAD');

  runRunner(fixture);

  assert.equal(git(fixture.repo, 'rev-parse', 'HEAD'), startingCommit);
  assert.equal(git(fixture.remote, 'rev-parse', 'refs/heads/main'), startingCommit);
  assert.equal(fs.readFileSync(path.join(fixture.repo, 'extra.txt'), 'utf8'), 'preserve me');
  assert.match(git(fixture.repo, 'status', '--porcelain'), /\?\? extra\.txt/);
  assert.match(fs.readFileSync(path.join(fixture.state, 'STOP'), 'utf8'), /Unsupported worktree state/);
});

test('autonomous runner stops before committing when sandboxed project checks fail', (t) => {
  if (process.platform !== 'win32' || !fs.existsSync(powershell)) return t.skip('Requires Windows PowerShell.');
  const fixture = makeFixture(t);
  fixture.noStop = true;
  fixture.edit = true;
  fixture.failChecks = true;
  const startingCommit = git(fixture.repo, 'rev-parse', 'HEAD');

  runRunner(fixture);

  assert.equal(git(fixture.repo, 'rev-parse', 'HEAD'), startingCommit);
  assert.equal(git(fixture.remote, 'rev-parse', 'refs/heads/main'), startingCommit);
  assert.match(git(fixture.repo, 'status', '--porcelain'), /^M seed\.txt/);
  assert.match(fs.readFileSync(path.join(fixture.state, 'STOP'), 'utf8'), /Project check evidence missing or failed/);
});

test('autonomous runner refuses a ready result without sandboxed test evidence', (t) => {
  if (process.platform !== 'win32' || !fs.existsSync(powershell)) return t.skip('Requires Windows PowerShell.');
  const fixture = makeFixture(t);
  fixture.noStop = true;
  fixture.edit = true;
  fixture.noEvidence = true;
  const startingCommit = git(fixture.repo, 'rev-parse', 'HEAD');

  runRunner(fixture);

  assert.equal(git(fixture.repo, 'rev-parse', 'HEAD'), startingCommit);
  assert.equal(git(fixture.remote, 'rev-parse', 'refs/heads/main'), startingCommit);
  assert.match(fs.readFileSync(path.join(fixture.state, 'STOP'), 'utf8'), /Project check evidence missing or failed/);
});

test('autonomous runner refuses model edits to its own supervisor script', (t) => {
  if (process.platform !== 'win32' || !fs.existsSync(powershell)) return t.skip('Requires Windows PowerShell.');
  const fixture = makeFixture(t);
  fixture.noStop = true;
  fixture.edit = true;
  fixture.editRunner = true;
  const startingCommit = git(fixture.repo, 'rev-parse', 'HEAD');

  runRunner(fixture);

  assert.equal(git(fixture.repo, 'rev-parse', 'HEAD'), startingCommit);
  assert.equal(git(fixture.remote, 'rev-parse', 'refs/heads/main'), startingCommit);
  assert.match(fs.readFileSync(path.join(fixture.state, 'STOP'), 'utf8'), /Trusted runner files changed/);
});

test('autonomous runner pauses on a dirty checkout without invoking Codex', (t) => {
  if (process.platform !== 'win32' || !fs.existsSync(powershell)) return t.skip('Requires Windows PowerShell.');
  const fixture = makeFixture(t);
  const userFile = path.join(fixture.repo, 'user-work.txt');
  fs.writeFileSync(userFile, 'keep me\n');

  runRunner(fixture);

  assert.equal(fs.existsSync(path.join(fixture.tempRoot, 'called.txt')), false);
  assert.equal(fs.readFileSync(userFile, 'utf8'), 'keep me\n');
  assert.match(fs.readFileSync(path.join(fixture.state, 'STOP'), 'utf8'), /Dirty repository/);
});
