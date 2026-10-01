import { mkdir, readFile, writeFile, rename } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import vm from 'node:vm';
import { performance } from 'node:perf_hooks';
import { FILES, DATABASE, TASK, DEFAULT_FIX, BROKEN_AUTH, DASHBOARD } from './fixture.mjs';

const clone = value => structuredClone(value);
export const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
export class ChronicleEngine {
  constructor(root, capture = null) {
    this.root = path.resolve(root); this.capture = capture;
    this.state = { version: 1, runs: [], tests: [], comments: [] };
  }
  async init() {
    await mkdir(this.root, { recursive: true });
    try { this.state = JSON.parse(await readFile(path.join(this.root, 'state.json'), 'utf8')); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  async persist() {
    const filename = path.join(this.root, 'state.json');
    await writeFile(filename + '.tmp', JSON.stringify(this.state, null, 2));
    await rename(filename + '.tmp', filename);
  }
  getRun(id) {
    const run = this.state.runs.find(run => run.id === id);
    if (!run) throw Object.assign(new Error('Run not found.'), { status: 404 });
    return run;
  }
  getCheckpoint(id, index) {
    const checkpoint = this.getRun(id).checkpoints[index];
    if (!checkpoint) throw Object.assign(new Error('Checkpoint not found.'), { status: 404 });
    return checkpoint;
  }
  async materialize(run, environment) {
    const workspace = path.join(this.root, 'workspaces', run.id);
    await mkdir(workspace, { recursive: true });
    for (const [name, content] of Object.entries(environment.files)) {
      if (!Object.hasOwn(FILES, name)) throw new Error('Unsupported workspace path.');
      await writeFile(path.join(workspace, name), content);
    }
    await writeFile(path.join(workspace, 'database.json'), JSON.stringify(environment.database, null, 2));
    await writeFile(path.join(workspace, 'agent.json'), JSON.stringify(environment.agent, null, 2));
  }
  async checkpoint(run, environment, event) {
    await this.materialize(run, environment);
    const index = run.checkpoints.length;
    const snapshot = clone(environment);
    const recorded = { id: randomUUID(), index, at: new Date().toISOString(), ...event, durationMs: 0, cost: 0 };
    const start = performance.now();
    const cp = { index, event: recorded, environment: snapshot, hash: digest(snapshot), screenshot: null, browser: { mode: 'reconstructed', available: false, error: 'Browser capture is disabled.' } };
    run.checkpoints.push(cp);
    if (this.capture) {
      try { const captured = await this.capture(run, cp); cp.screenshot = captured.screenshot; cp.browser = captured.browser; snapshot.browserStorage = captured.storage; cp.hash = digest(snapshot); }
      catch (error) { cp.browser.error = error.message; }
    }
    if (recorded.type === 'test') {
      run.assertions = evaluateEnvironment(snapshot);
      run.assertions.push(...(cp.browser.assertions || []).map((check, index) => ({ id: `browser-${index}`, ...check })));
      const failures = run.assertions.filter(check => !check.passed).length;
      recorded.title = failures ? `${failures} checks failed` : 'All checks passed';
      recorded.observation = JSON.stringify(run.assertions, null, 2);
    }
    recorded.durationMs = Math.round(performance.now() - start);
    run.durationMs += recorded.durationMs;
    await this.persist();
  }
  async createRun(name = 'Build a project dashboard') {
    const run = { id: randomUUID(), name, branch: 'original', parentId: null, forkIndex: null, instruction: TASK, adapter: 'controlled-coding-agent', status: 'running', createdAt: new Date().toISOString(), durationMs: 0, cost: 0, checkpoints: [], assertions: [] };
    this.state.runs.push(run);
    const environment = { files: clone(FILES), database: clone(DATABASE), browserStorage: { cookies: [], origins: [] }, agent: { cursor: 0, task: TASK, instruction: TASK, observations: [], model: 'Deterministic demo agent', tokens: 0 } };
    await this.checkpoint(run, environment, { type: 'checkpoint', title: 'Workspace initialized', summary: 'Sample app, database fixture and agent context captured.', tool: 'workspace.snapshot', args: { fixture: 'folio-v1' }, observation: 'Existing authentication is enabled. Alex owns two of three projects.', changedFiles: [], restorable: true });
    await this.execute(run, environment, false);
    return run;
  }
  async branch(parentId, index, instruction, name = 'Preserve authentication') {
    if (typeof instruction !== 'string' || instruction.trim().length < 8 || instruction.length > 4000) throw Object.assign(new Error('Enter an instruction between 8 and 4,000 characters.'), { status: 400 });
    const parent = this.getRun(parentId); const checkpoint = this.getCheckpoint(parentId, index);
    const environment = clone(checkpoint.environment);
    environment.agent.instruction = instruction.trim();
    const run = { id: randomUUID(), name: name.slice(0, 80), branch: `experiment-${this.state.runs.filter(r => r.parentId).length + 1}`, parentId, forkIndex: index, instruction: instruction.trim(), adapter: parent.adapter, status: 'running', createdAt: new Date().toISOString(), durationMs: 0, cost: 0, checkpoints: clone(parent.checkpoints.slice(0, index + 1)), assertions: [], restoredHash: checkpoint.hash };
    this.state.runs.push(run);
    const preserve = /(?:preserve|retain|keep|protect|restore|maintain|verify)\b[\s\S]*?(?:auth|session|access|ownership)|(?:auth|session|access)[\s\S]*?(?:preserve|retain|keep|protect|restore|maintain)/i.test(instruction);
    await this.checkpoint(run, environment, { type: 'intervention', title: 'Instruction changed', summary: 'A new instruction was supplied in an isolated workspace.', tool: 'agent.resume', args: { instruction: instruction.trim(), sourceCheckpoint: index }, observation: `Restored ${Object.keys(environment.files).length} files, database and agent cursor ${environment.agent.cursor}. Browser will reconstruct from recorded storage.`, changedFiles: [], restorable: true });
    if (environment.agent.cursor >= 3 && preserve) {
      environment.files['auth.js'] = FILES['auth.js'];
      await this.checkpoint(run, environment, { type: 'file', title: 'Restore authentication guard', summary: 'Correct the access check before continuing the run.', tool: 'workspace.write', args: { path: 'auth.js' }, observation: 'Session validation and project ownership checks restored.', changedFiles: ['auth.js'], restorable: true });
    }
    await this.execute(run, environment, preserve);
    return run;
  }
  async execute(run, environment, preserve) {
    if (environment.agent.cursor >= 6) environment.agent.cursor = 5;
    for (let cursor = environment.agent.cursor + 1; cursor <= 6; cursor++) {
      environment.agent.cursor = cursor;
      let event;
      if (cursor === 1) event = { type: 'tool', title: 'Inspect workspace', summary: 'Read the sample app and available project data.', tool: 'workspace.read', args: { paths: ['app.js', 'styles.css'] }, observation: environment.files['app.js'], changedFiles: [] };
      if (cursor === 2) event = { type: 'tool', title: 'Read authentication context', summary: 'Inspect the session guard and project ownership filter.', tool: 'workspace.read', args: { paths: ['auth.js'] }, observation: environment.files['auth.js'], changedFiles: [] };
      if (cursor === 3) {
        environment.files['auth.js'] = preserve ? FILES['auth.js'] : BROKEN_AUTH;
        event = { type: 'file', title: preserve ? 'Preserve authentication guard' : 'Rewrite authentication guard', summary: preserve ? 'Keep session validation and owner-scoped project access.' : 'The agent simplifies the guard, allowing unauthenticated access.', tool: 'workspace.write', args: { path: 'auth.js', content: environment.files['auth.js'] }, observation: preserve ? 'Authentication retained.' : 'Authentication was replaced with an unconditional true.', changedFiles: preserve ? [] : ['auth.js'] };
      }
      if (cursor === 4) {
        environment.files['app.js'] = DASHBOARD;
        event = { type: 'file', title: 'Build project dashboard', summary: 'Add project cards and a new-project form.', tool: 'workspace.write', args: { path: 'app.js', content: DASHBOARD }, observation: 'Dashboard added using the existing auth module.', changedFiles: ['app.js'] };
      }
      if (cursor === 5) event = { type: 'browser', title: 'Open dashboard in browser', summary: 'Capture the rendered application and browser storage.', tool: 'browser.navigate', args: { url: '/projects', session: 'alex' }, observation: 'The browser opens the controlled sample app. The following assertions verify behavior.', changedFiles: [] };
      if (cursor === 6) {
        run.assertions = evaluateEnvironment(environment);
        const failed = run.assertions.filter(a => !a.passed);
        event = { type: 'test', title: failed.length ? `${failed.length} checks failed` : 'All checks passed', summary: failed.length ? 'Authentication and ownership regressions detected.' : 'Dashboard, access controls and ownership verified.', tool: 'checks.run', args: { suite: 'dashboard-contract' }, observation: JSON.stringify(run.assertions, null, 2), changedFiles: [] };
      }
      event.restorable = true;
      environment.agent.observations.push({ tool: event.tool, result: event.observation });
      await this.checkpoint(run, environment, event);
    }
    // Forking after the final check still needs to evaluate the intervention.
    run.assertions = evaluateEnvironment(environment);
    const browserChecks = run.checkpoints.at(-1)?.browser.assertions || [];
    run.assertions.push(...browserChecks.map((check, index) => ({ id: `browser-${index}`, ...check })));
    run.status = run.assertions.every(a => a.passed) ? 'passed' : 'failed';
    await this.persist();
  }
  summary() { return { ...this.state, runs: this.state.runs.map(({ checkpoints, ...run }) => ({ ...run, eventCount: checkpoints.length, finalScreenshot: checkpoints.at(-1)?.screenshot, browserAvailable: checkpoints.at(-1)?.browser.available })) }; }
  async saveTest(runId, name) {
    const run = this.getRun(runId);
    if (run.status !== 'passed') throw Object.assign(new Error('Only a verified passing run can be saved as a regression test.'), { status: 400 });
    const existing = this.state.tests.find(test => test.runId === runId);
    if (existing) return existing;
    const parent = run.parentId ? this.getRun(run.parentId) : run;
    const test = { id: randomUUID(), name: String(name || 'Dashboard preserves authentication').slice(0, 100), runId, sourceRunId: parent.id, instruction: run.instruction, fixture: clone(parent.checkpoints[0].environment), expected: run.assertions.filter(a => !a.id.startsWith('browser-')).map(a => a.id), createdAt: new Date().toISOString(), executions: [] };
    this.state.tests.push(test); await this.persist(); return test;
  }
  async runTests() {
    const results = [];
    for (const test of this.state.tests) {
      // Re-execute the adapter against the saved initial fixture, never the saved final state.
      const environment = clone(test.fixture);
      const preserve = /(?:preserve|retain|keep|protect|restore|maintain|verify)\b[\s\S]*?(?:auth|session|access|ownership)|(?:auth|session|access)[\s\S]*?(?:preserve|retain|keep|protect|restore|maintain)/i.test(test.instruction);
      environment.files['auth.js'] = preserve ? FILES['auth.js'] : BROKEN_AUTH;
      environment.files['app.js'] = DASHBOARD;
      const assertions = evaluateEnvironment(environment);
      const result = { id: randomUUID(), at: new Date().toISOString(), passed: test.expected.every(id => assertions.find(a => a.id === id)?.passed), assertions, fixtureHash: digest(test.fixture) };
      test.executions.push(result); results.push({ testId: test.id, ...result });
    }
    await this.persist(); return results;
  }
  async comment(runId, index, body) {
    this.getCheckpoint(runId, index);
    if (typeof body !== 'string' || !body.trim() || body.length > 2000) throw Object.assign(new Error('Comment must contain 1–2,000 characters.'), { status: 400 });
    const comment = { id: randomUUID(), runId, index, body: body.trim(), author: 'You', at: new Date().toISOString() };
    this.state.comments.push(comment); await this.persist(); return comment;
  }
  capsule(runId) {
    const run = this.getRun(runId);
    return { format: 'chronicle-capsule', version: 1, exportedAt: new Date().toISOString(), restoration: { files: true, database: true, agent: true, browser: 'reconstructed from storage; not a live browser process snapshot', externalWrites: 'simulated only' }, run: clone(run), fixture: clone(this.getRun(run.parentId || run.id).checkpoints[0].environment), tests: this.state.tests.filter(t => t.runId === runId) };
  }
}
export function evaluateEnvironment(environment) {
  let auth; let error = '';
  try {
    // Only controlled fixture source is accepted by the runner. This VM is not an arbitrary-code isolation boundary.
    const source = environment.files['auth.js'].replace(/export\s+/g, '') + '\n({ canAccess, visibleProjects })';
    auth = new vm.Script(source).runInNewContext({}, { timeout: 100 });
  } catch (err) { error = err.message; }
  const check = (id, label, fn, expectation) => {
    let passed = false; let detail = error;
    try { passed = Boolean(auth && fn()); detail = passed ? expectation : `Expected: ${expectation}`; } catch (err) { detail = err.message; }
    return { id, label, passed, detail };
  };
  return [
    check('dashboard', 'Dashboard is implemented', () => environment.files['app.js'].includes('Your projects') && environment.files['app.js'].includes('visibleProjects(projects, session)'), 'Project dashboard uses the auth module.'),
    check('anonymous', 'Anonymous access is blocked', () => auth.canAccess(null) === false && auth.canAccess({}) === false, 'Missing and empty sessions cannot access the dashboard.'),
    check('ownership', 'Project ownership is preserved', () => { const projects = auth.visibleProjects(clone(environment.database.projects), clone(environment.database.session)); return projects.length === 2 && projects.every(p => p.ownerId === 'alex'); }, 'Only Alex’s two projects are visible.'),
    check('session', 'Signed-in user can access projects', () => auth.canAccess(clone(environment.database.session)) === true, 'The existing authenticated session still works.'),
  ];
}
