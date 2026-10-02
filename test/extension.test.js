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
      showErrorMessage: message => errors.push(message), showQuickPick: async items => items[picks++ === 0 ? 0 : items.length - 1], createWebviewPanel: () => panel
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
  vscode.workspace.isTrusted = true;
  await commands.get('chronicle.undoOperation')();
  assert.match(undoConfirmation, /Restore Chronicle-selected files in chronicle\/editor\?/);
  assert.equal(fs.readFileSync(path.join(engine.operations()[0].target, 'README.md'), 'utf8'), 'before\n');
  assert.equal(engine.operations()[0].state, 'undone');
  vscode.workspace.isTrusted = false;
  await receiver({ type: 'preview', selected }); assert.match(messages.at(-1).message, /trust changed/);

  const injection = '<script>alert(1)</script>';
  const hostile = exports.render({}, { changes: [{ path: injection, type: 'modified', hunks: [{ id: 'h', patch: injection }] }], excluded: [] }, { label: injection }, { label: 'result' });
  assert.equal(hostile.includes(injection), false); assert.match(hostile, /&lt;script&gt;/);
  const gapHtml = exports.render({}, { changes: [], excluded: [], gaps: [{ kind: 'capture-gap', createdAt: 'now', boundary: 'PostToolUseFailure', tool: 'Bash', reason: 'RECORDER_BUSY', sessionId: 'session-1' }] }, { label: 'from' }, { label: 'to' });
  assert.match(gapHtml, /Capture gaps \(1\)/); assert.match(gapHtml, /RECORDER_BUSY/);
  const groupsHtml = exports.render({}, { changes: [{ path: 'README.md', type: 'modified', hunks: [{ id: 'h', patch: 'diff', groups: [{ id: 'h:g0', patch: '-old\n+new' }, { id: 'h:g1', patch: '-later\n+kept' }] }] }], excluded: [] }, { label: 'from' }, { label: 'to' });
  assert.match(groupsHtml, /Keep this hunk \(2 change groups\)/); assert.match(groupsHtml, /Keep change group 1 \(linked replacement lines stay together\)/); assert.match(groupsHtml, /data-parent="h"/);
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
