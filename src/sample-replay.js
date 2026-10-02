'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const { createSimulatedReplay } = require('./simulated-replay');
const { resetSampleApp } = require('./sample-app');

const INITIAL_README = '# Sample app\n\n## Setup\nInstall dependencies.\n\n## Authentication\nUse the local sign-in form.\n';
const INITIAL_APP_STATE = require('../fixtures/sample-app/state.json');

function git(root, args) {
  const env = { ...process.env };
  for (const name of Object.keys(env)) if (name.startsWith('GIT_')) delete env[name];
  const result = spawnSync('git', ['-c', 'core.hooksPath=' + path.join(root, '.no-hooks'), ...args], {
    cwd: root, encoding: 'utf8', timeout: 30000, windowsHide: true,
    env: { ...env, GIT_OPTIONAL_LOCKS: '0', GIT_TERMINAL_PROMPT: '0' }
  });
  if (result.error || result.status !== 0) throw new Error((result.stderr || result.stdout || result.error?.message || 'Git failed').trim());
  return result.stdout.trim();
}

function scriptedAgent(worktree, instruction, issue, search) {
  const readmePath = path.join(worktree, 'README.md');
  const current = fs.readFileSync(readmePath, 'utf8');
  const summary = `## Issue #${issue.issueId}: ${issue.title}\n\nRelevant files: ${search.results.map(result => result.path).join(', ')}.\n`;
  const output = /preserve existing headings/i.test(instruction)
    ? current.trimEnd() + '\n\n' + summary
    : `# ${issue.title}\n\n${summary}`;
  fs.writeFileSync(readmePath, output);
}

function isTempChild(tempRoot, candidate) {
  const relative = path.relative(tempRoot, candidate);
  return Boolean(relative) && relative !== '..' && !relative.startsWith('..' + path.sep) && !path.isAbsolute(relative);
}

function runSampleReplay(sandboxRoot, cassette) {
  const tempRoot = fs.realpathSync(path.resolve(os.tmpdir()));
  const sandboxPath = path.resolve(sandboxRoot);
  if (!isTempChild(tempRoot, sandboxPath)) throw new Error('Sample replay requires a new directory under the system temp folder.');
  if (!fs.existsSync(sandboxPath) || fs.readdirSync(sandboxPath).length !== 0) throw new Error('Sample replay root must exist and be empty.');
  const realSandboxPath = fs.realpathSync(sandboxPath);
  if (!isTempChild(tempRoot, realSandboxPath)) {
    throw new Error('Sample replay requires a new directory under the system temp folder.');
  }

  const source = path.join(sandboxPath, 'source');
  fs.mkdirSync(source);
  git(source, ['init', '--quiet', '--initial-branch=main']);
  git(source, ['config', 'user.name', 'Chronicle Replay Demo']);
  git(source, ['config', 'user.email', 'chronicle-replay-demo@example.invalid']);
  fs.writeFileSync(path.join(source, 'README.md'), INITIAL_README);
  resetSampleApp(source, INITIAL_APP_STATE);
  git(source, ['add', 'README.md']);
  git(source, ['add', 'sample-app/state.json']);
  git(source, ['commit', '--quiet', '-m', 'sample baseline']);
  const baseline = git(source, ['rev-parse', 'HEAD']);

  const runs = [];
  for (const [name, instruction] of [
    ['replace', 'Summarize issue 42.'],
    ['preserve', 'Summarize issue 42 and preserve existing headings.']
  ]) {
    const branch = `chronicle/simulated-${name}-${crypto.randomUUID().slice(0, 8)}`;
    const worktree = path.join(sandboxPath, name);
    git(source, ['worktree', 'add', '--quiet', '-b', branch, worktree, baseline]);
    const environment = resetSampleApp(worktree, INITIAL_APP_STATE);
    const replay = createSimulatedReplay(cassette);
    const issue = replay.invoke('fixture.issue.lookup', { issueId: '42' });
    const search = replay.invoke('fixture.issue.search', { query: 'README headings', limit: 2 });
    replay.assertComplete();
    if (git(worktree, ['rev-parse', 'HEAD']) !== baseline) throw new Error('Sample replay did not start from the common baseline.');
    scriptedAgent(worktree, instruction, issue.response, search.response);
    runs.push({ name, branch, instruction, worktree, baseline, environment, output: fs.readFileSync(path.join(worktree, 'README.md'), 'utf8'), evidence: [issue.evidence, search.evidence] });
  }

  if (git(source, ['status', '--porcelain']) !== '' || git(source, ['rev-parse', '--abbrev-ref', 'HEAD']) !== 'main' ||
      fs.readFileSync(path.join(source, 'README.md'), 'utf8') !== INITIAL_README) {
    throw new Error('Sample replay changed the original fixture workspace.');
  }
  if (fs.readFileSync(path.join(source, 'sample-app', 'state.json'), 'utf8') !== JSON.stringify(INITIAL_APP_STATE, null, 2) + '\n') {
    throw new Error('Sample replay changed the original sample app state.');
  }
  return { sandbox: realSandboxPath, baseline, runs, identicalOutput: runs[0].output === runs[1].output };
}

module.exports = { runSampleReplay, INITIAL_README };
