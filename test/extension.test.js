'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const vm = require('node:vm');
const { Chronicle, git } = require('../src/engine');

test('editor command flow requires preview and produces a separate selected workspace', async t => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'chronicle-editor-test-'));
  t.after(() => fs.rmSync(base, { recursive: true, force: true }));
  const root = path.join(base, 'repo'); fs.mkdirSync(root);
  git(root, ['init']); git(root, ['config', 'user.name', 'Test']); git(root, ['config', 'user.email', 'test@example.invalid']);
  fs.writeFileSync(path.join(root, 'README.md'), 'before\n'); git(root, ['add', '.']); git(root, ['commit', '-m', 'Baseline']);
  const storage = path.join(base, 'history');
  const commands = new Map(), messages = [], errors = [], disposables = [];
  let receiver, html, undoConfirmation, picks = 0;
  class TestChronicle extends Chronicle { constructor(directory) { super(directory, { storage }); } }
  const engine = new TestChronicle(root);
  const panel = {
    webview: { set html(value) { html = value; }, postMessage: async message => messages.push(message), onDidReceiveMessage: fn => { receiver = fn; return { dispose() {} }; } },
    onDidDispose() {}, dispose() {}
  };
  const vscode = {
    workspace: { isTrusted: true, workspaceFolders: [{ uri: { scheme: 'file', fsPath: root } }] },
    window: {
      showInputBox: async () => 'Checkpoint', showInformationMessage: async () => undefined, showWarningMessage: async message => { undoConfirmation = message; return 'Undo Chronicle output'; },
      showErrorMessage: message => errors.push(message), showQuickPick: async (items, options = {}) => options.canPickMany ? items : options.title === 'Choose Chronicle output to undo or resume' ? items.find(item => item.label === 'chronicle/editor') : items[picks++ === 0 ? 0 : items.length - 1], createWebviewPanel: () => panel
    },
    commands: { registerCommand: (id, fn) => { commands.set(id, fn); return { dispose() {} }; }, executeCommand: async () => {} },
    ViewColumn: { Beside: 2 }, Uri: { file: p => ({ fsPath: p }) }
  };
  const loaded = { exports: {} };
  const wrapper = vm.runInThisContext('(function(require,module){' + fs.readFileSync(path.join(__dirname, '../src/extension.js'), 'utf8') + '\n})');
  wrapper(name => name === 'vscode' ? vscode : name === './engine' ? { Chronicle: TestChronicle } : require(name), loaded);
  const exports = loaded.exports;
  exports.activate({ subscriptions: disposables });
  await commands.get('chronicle.capture')();
  fs.writeFileSync(path.join(root, 'README.md'), 'after\n');
  await commands.get('chronicle.capture')();
  await commands.get('chronicle.review')();
  assert.equal(errors.length, 0); assert.match(html, /Content-Security-Policy/);
  const [a, b] = engine.list();
  const selected = engine.compare(a.id, b.id).changes.flatMap(f => f.hunks.map(h => h.id));
  await receiver({ type: 'apply', selected, branch: 'chronicle/editor' });
  assert.match(messages.at(-1).message, /Preview the current selection/); assert.equal(engine.operations().length, 0);
  await receiver({ type: 'preview', selected }); assert.equal(messages.at(-1).files[0].content, 'after\n');
  await receiver({ type: 'apply', selected, branch: 'chronicle/editor' });
  assert.equal(messages.at(-1).type, 'applied');
  assert.equal(fs.readFileSync(path.join(engine.operations()[0].target, 'README.md'), 'utf8'), 'after\n');
  engine.recordCheck(engine.operations().find(op => op.branch === 'chronicle/editor').id, 'npm test', 0);
  const copy = engine.createBranch(a.id, b.id, selected, 'chronicle/editor-copy');
  engine.recordCheck(copy.id, 'lint', 3);
  await commands.get('chronicle.compareOperations')();
  assert.equal(errors.length, 0);
  assert.match(html, /Saved branch comparison/); assert.match(html, /chronicle\/editor-copy/); assert.match(html, /npm test — reported-pass \(exit 0, user-reported\)/); assert.match(html, /lint — reported-fail \(exit 3, user-reported\)/); assert.match(html, /Reported cost: Unavailable/);
  assert.match(html, /chronicle\/editor · saved result/); assert.match(html, /README\.md/);
  vscode.workspace.isTrusted = true;
  await commands.get('chronicle.undoOperation')();
  assert.match(undoConfirmation, /Restore Chronicle-selected files in chronicle\/editor\?/);
  const originalOperation = engine.operations().find(op => op.branch === 'chronicle/editor');
  assert.equal(fs.readFileSync(path.join(originalOperation.target, 'README.md'), 'utf8'), 'before\n');
  assert.equal(originalOperation.state, 'undone');
  vscode.workspace.isTrusted = false;
  await receiver({ type: 'preview', selected }); assert.match(messages.at(-1).message, /trust changed/);

  const injection = '<script>alert(1)</script>';
  const hostile = exports.render({}, { changes: [{ path: injection, type: 'modified', hunks: [{ id: 'h', patch: injection }] }], excluded: [] }, { label: injection }, { label: 'result' });
  assert.equal(hostile.includes(injection), false); assert.match(hostile, /&lt;script&gt;/);
  const gapHtml = exports.render({}, { changes: [], excluded: [], gaps: [{ kind: 'capture-gap', createdAt: 'now', boundary: 'PostToolUseFailure', tool: 'Bash', reason: 'RECORDER_BUSY', sessionId: 'session-1' }] }, { label: 'from' }, { label: 'to' });
  assert.match(gapHtml, /Capture gaps \(1\)/); assert.match(gapHtml, /RECORDER_BUSY/);
  const warningHtml = exports.render({}, { changes: [], excluded: [], coverageWarnings: [
    { createdAt: 'now', tool: injection, reason: 'POST_BOUNDARY_UNOBSERVED', sessionId: 'session-1' },
    { createdAt: 'later', tool: 'Bash', reason: 'TOOL_BOUNDARY_ID_UNAVAILABLE' }
  ] }, { label: 'from' }, { label: 'to' });
  assert.match(warningHtml, /Unpaired or uncorrelatable tool boundaries \(2\)/);
  assert.match(warningHtml, /outcome unknown/);
  assert.match(warningHtml, /session unavailable/);
  assert.equal(warningHtml.includes(injection), false);
  const unavailableHtml = exports.render({}, { changes: [], excluded: [], coverageWarnings: null }, { label: 'from' }, { label: 'to' });
  assert.match(unavailableHtml, /Tool-boundary coverage unavailable/);
  const groupsHtml = exports.render({}, { changes: [{ path: 'README.md', type: 'modified', hunks: [{ id: 'h', patch: 'diff', groups: [{ id: 'h:g0', patch: '-old\n+new' }, { id: 'h:g1', patch: '-later\n+kept' }] }] }], excluded: [] }, { label: 'from' }, { label: 'to' });
  assert.match(groupsHtml, /Keep this hunk \(2 change groups\)/); assert.match(groupsHtml, /Keep change group 1 \(linked replacement lines stay together\)/); assert.match(groupsHtml, /data-parent="h"/);
  const comparisonHtml = exports.renderComparison({}, { first: { id: 'one', branch: injection, manifest: { environment: { node: 'v1', platform: 'win32', architecture: 'x64' }, checks: [{ label: injection, outcome: 'reported-fail', exitCode: 1, source: 'user-reported' }], reportedCost: null, captureCoverage: { gaps: 0, excludedFiles: 0 }, selectedChangeIds: [] } }, second: { id: 'two', branch: 'chronicle/good', manifest: { environment: { node: 'v1', platform: 'win32', architecture: 'x64' }, checks: [], reportedCost: null, captureCoverage: { gaps: 0, excludedFiles: 0 }, selectedChangeIds: [] } }, files: [{ path: injection, status: 'changed', first: { hash: 'a'.repeat(64), mode: '100644' }, second: { hash: 'b'.repeat(64), mode: '100644' } }] });
  assert.equal(comparisonHtml.includes(injection), false); assert.match(comparisonHtml, /&lt;script&gt;/); assert.match(comparisonHtml, /default-src 'none'/);
  assert.match(comparisonHtml, /Unpaired tool boundaries: Unavailable/);
  const limitedManifest = gaps => ({ environment: { node: 'v1', platform: 'win32', architecture: 'x64' },
    checks: [], reportedCost: null, captureCoverage: gaps, selectedChangeIds: [] });
  const limited = exports.renderComparison({}, { first: { id: 'one', branch: 'limited',
    manifest: limitedManifest({ gaps: 1000, gapHistoryLimitReached: true, excludedFiles: 0 }) },
  second: { id: 'two', branch: 'other', manifest: limitedManifest({ gaps: 0, excludedFiles: 0 }) }, files: [] });
  assert.match(limited, /Capture gaps: 1000 \(history limit reached; later gaps may be missing\)/);
  const boundHtml = exports.renderComparison({}, { first: { id: 'one', branch: 'first', manifest: { environment: { node: 'v1', platform: 'win32', architecture: 'x64' }, checks: [], reportedCost: null, captureCoverage: { gaps: 0, excludedFiles: 0 }, selectedChangeIds: [] }, fixtureEvidence: { runId: 'fixture-run', injectedFixtureCalls: 2, rejectedFixtureCalls: 0, liveToolCalls: null } }, second: { id: 'two', branch: 'second', manifest: { environment: { node: 'v1', platform: 'win32', architecture: 'x64' }, checks: [], reportedCost: null, captureCoverage: { gaps: 0, excludedFiles: 0 }, selectedChangeIds: [] }, fixtureEvidence: null }, files: [] });
  assert.match(boundHtml, /2 injected calls, 0 rejected calls\. Live tool activity: Unavailable/);
  assert.match(boundHtml, /Bound fixture evidence: Unavailable/);
  const input = (value, dataset, checked) => ({ value, dataset, checked, addEventListener(name, fn) { this[name] = fn; } });
  const boxes = [input('h', { hasGroups: 'true' }, true), input('h:g0', { parent: 'h' }, true), input('h:g1', { parent: 'h' }, true)];
  const elements = Object.fromEntries(['all', 'none', 'preview', 'apply', 'status', 'output', 'branch'].map(id => [id, { replaceChildren() {}, value: 'chronicle/test' }]));
  let posted, messageListener;
  const script = groupsHtml.match(/<script[^>]*>([\s\S]*?)<\/script>/)[1];
  vm.runInNewContext(script, {
    acquireVsCodeApi: () => ({ postMessage: message => { posted = message; } }),
    document: { querySelectorAll: () => boxes, getElementById: id => elements[id] },
    window: { addEventListener: (name, fn) => { messageListener = fn; } }
  });
  boxes[1].checked = false; boxes[1].change(); elements.preview.onclick();
  assert.deepEqual([...posted.selected], ['h:g1']);
  messageListener({ data: { type: 'preview', files: [], message: 'ok' } });
  boxes[0].checked = true; boxes[0].change(); elements.preview.onclick();
  assert.deepEqual([...posted.selected], ['h']);
});
