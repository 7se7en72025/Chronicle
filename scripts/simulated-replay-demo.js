'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { createSimulatedReplay } = require('../src/simulated-replay');
const { runSampleReplay } = require('../src/sample-replay');

const cassettePath = path.join(__dirname, '..', 'fixtures', 'simulated-tools', 'issue-tracker.json');
const cassette = JSON.parse(fs.readFileSync(cassettePath, 'utf8'));
const replay = createSimulatedReplay(cassette);
const issue = replay.invoke('fixture.issue.lookup', { issueId: '42' });
const matches = replay.invoke('fixture.issue.search', { limit: 2, query: 'README headings' });
const result = replay.assertComplete();

if (issue.response.title !== 'Keep headings when selecting README edits' ||
    matches.response.results.length !== 2 || result.status !== 'complete') {
  throw new Error('Controlled simulated replay fixture did not produce its expected result.');
}
console.log(`Controlled fixture replay passed: ${result.consumedCalls} injected responses; no live tools or model requests.`);

const sandbox = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'chronicle-simulated-agent-'));
const branches = runSampleReplay(sandbox, cassette);
console.log(`Scripted sample task created two worktrees from ${branches.baseline.slice(0, 12)}; original workspace stayed clean.`);
for (const run of branches.runs) console.log(`${run.name}: ${run.branch} -> ${run.worktree}`);
console.log('The “preserve headings” instruction changes the scripted output; this demo does not invoke an AI agent.');
