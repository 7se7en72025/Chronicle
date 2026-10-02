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
  git(repo, 'add', 'seed.txt', 'scripts/run-autonomous.ps1');
  git(repo, 'commit', '--quiet', '-m', 'seed fixture');
  git(repo, 'remote', 'add', 'origin', remote);
  git(repo, 'push', '--quiet', '--set-upstream', 'origin', 'main');

  const fakeCodex = path.join(tempRoot, 'fake codex.ps1');
  fs.writeFileSync(fakeCodex, [
    "$outIndex = [Array]::IndexOf($args, '--output-last-message')",
    'if ($outIndex -lt 0) { exit 13 }',
    "if ($env:CHRONICLE_AUTONOMOUS_PROMPT -notmatch 'review-and-improve') { exit 14 }",
    "if ($env:CHRONICLE_FAKE_COMMIT -eq '1') { Push-Location $env:CHRONICLE_FIXTURE_REPO; try { [System.IO.File]::WriteAllText('cycle-result.txt', 'verified fixture'); & git add -- cycle-result.txt; & git commit --quiet -m 'verified fixture cycle'; if ($LASTEXITCODE -ne 0) { exit 15 } } finally { Pop-Location } }",
    "if ($env:CHRONICLE_FAKE_NO_STOP -eq '1') { if ($env:CHRONICLE_FAKE_COMMIT -eq '1') { Push-Location $env:CHRONICLE_FIXTURE_REPO; try { $summary = 'CHRONICLE_RUNNER_READY ' + (& git rev-parse HEAD).Trim() } finally { Pop-Location } } else { $summary = 'Fixture cycle complete.' } } else { $summary = \"CHRONICLE_RUNNER_STOP`nFixture queue complete.\" }",
    '[System.IO.File]::WriteAllText($args[$outIndex + 1], $summary)',
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
      CHRONICLE_FAKE_COMMIT: fixture.commit ? '1' : '0',
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

test('autonomous runner pauses when a cycle fails to commit exactly one result', (t) => {
  if (process.platform !== 'win32' || !fs.existsSync(powershell)) return t.skip('Requires Windows PowerShell.');
  const fixture = makeFixture(t);
  fixture.noStop = true;

  runRunner(fixture);

  assert.ok(fs.existsSync(path.join(fixture.tempRoot, 'called.txt')));
  assert.match(fs.readFileSync(path.join(fixture.state, 'STOP'), 'utf8'), /No verified commit marker/);
  assert.equal(git(fixture.repo, 'rev-parse', 'HEAD'), git(fixture.repo, 'rev-parse', 'refs/remotes/origin/main'));
});

test('autonomous runner accepts one clean commit rooted at its starting main commit', (t) => {
  if (process.platform !== 'win32' || !fs.existsSync(powershell)) return t.skip('Requires Windows PowerShell.');
  const fixture = makeFixture(t);
  fixture.noStop = true;
  fixture.commit = true;
  const startingCommit = git(fixture.repo, 'rev-parse', 'HEAD');

  runRunner(fixture);

  assert.notEqual(git(fixture.repo, 'rev-parse', 'HEAD'), startingCommit);
  assert.equal(git(fixture.repo, 'rev-parse', 'HEAD^'), startingCommit);
  assert.equal(fs.readFileSync(path.join(fixture.repo, 'cycle-result.txt'), 'utf8'), 'verified fixture');
  assert.equal(git(fixture.repo, 'status', '--porcelain'), '');
  assert.equal(git(fixture.remote, 'rev-parse', 'refs/heads/main'), git(fixture.repo, 'rev-parse', 'HEAD'));
  assert.equal(git(fixture.repo, 'rev-parse', 'refs/remotes/origin/main'), git(fixture.repo, 'rev-parse', 'HEAD'));
  const stopPath = path.join(fixture.state, 'STOP');
  assert.equal(fs.existsSync(stopPath), false, fs.existsSync(stopPath) ? fs.readFileSync(stopPath, 'utf8') : undefined);
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
