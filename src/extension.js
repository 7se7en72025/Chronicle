'use strict';
const vscode = require('vscode');
const crypto = require('node:crypto');
const { Chronicle } = require('./engine');

const escape = value => String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

async function workspace() {
  if (!vscode.workspace.isTrusted) throw new Error('Chronicle requires a trusted workspace.');
  const folders = vscode.workspace.workspaceFolders || [];
  if (!folders.length) throw new Error('Open a local Git workspace first.');
  const selected = folders.length === 1 ? folders[0] : await vscode.window.showWorkspaceFolderPick();
  if (!selected) return;
  if (selected.uri.scheme !== 'file') throw new Error('Only filesystem workspaces are supported.');
  return new Chronicle(selected.uri.fsPath);
}

function render(webview, diff, baseline, result) {
  const nonce = crypto.randomBytes(20).toString('hex');
  const gaps = diff.gaps?.length ? `<section><h2>Capture gaps (${diff.gaps.length})</h2>${diff.gaps.map(gap => gap.kind === 'capture-gap-limit' ? `<p>${escape(gap.message)}</p>` : `<p>${escape(gap.createdAt)} · ${escape(gap.boundary || 'unknown boundary')} · ${escape(gap.tool || 'unknown tool')} · ${escape(gap.reason)} (${escape(gap.sessionId || 'session unavailable')})</p>`).join('')}</section>` : '';
  const groups = gaps + diff.changes.map(file => `<section><h2>${escape(file.path)} <small>${escape(file.type)}</small></h2>${file.hunks.map(h => `<label class="choice"><input type="checkbox" value="${escape(h.id)}"${h.groups?.length > 1 ? ' data-has-groups="true"' : ''}> Keep ${h.wholeFile ? 'whole file' : `this hunk${h.groups?.length > 1 ? ` (${h.groups.length} change groups)` : ''}`}</label><pre>${escape(h.patch)}</pre>${h.groups?.length > 1 ? h.groups.map((group, index) => `<label class="choice"><input type="checkbox" value="${escape(group.id)}" data-parent="${escape(h.id)}"> Keep change group ${index + 1} (linked replacement lines stay together)</label><pre>${escape(group.patch)}</pre>`).join('') : ''}`).join('')}</section>`).join('');
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'nonce-${nonce}'; script-src 'nonce-${nonce}';"><meta name="viewport" content="width=device-width, initial-scale=1"><style nonce="${nonce}">
    body{font-family:var(--vscode-font-family);color:var(--vscode-foreground);padding:24px;max-width:1100px;margin:auto}h1{font-size:28px}small{opacity:.7}section{border:1px solid var(--vscode-panel-border);padding:16px;margin:18px 0;border-radius:8px}pre{white-space:pre-wrap;overflow-wrap:anywhere;font-family:var(--vscode-editor-font-family);font-size:var(--vscode-editor-font-size);background:var(--vscode-textCodeBlock-background);padding:12px}button{background:var(--vscode-button-background);color:var(--vscode-button-foreground);border:0;padding:10px 14px;margin:6px 8px 6px 0;cursor:pointer}button:disabled{opacity:.5;cursor:default}input[type=text]{background:var(--vscode-input-background);color:var(--vscode-input-foreground);border:1px solid var(--vscode-input-border);padding:8px;min-width:240px}.choice{display:block;margin-top:16px}#status{white-space:pre-wrap}aside{padding:12px;border-left:3px solid var(--vscode-focusBorder)}
  </style></head><body><h1>Chronicle <small>Local review</small></h1><p>${escape(baseline.label)} → ${escape(result.label)}</p><aside>Manual checkpoints · attribution unknown · no model requests<br>The output goes to a separate branch and workspace. Your current edits stay here.</aside>
  ${diff.excluded.length ? `<p>Capture exclusions: ${escape(diff.excluded.map(f => f.path + ' (' + f.reason + ')').join(', '))}. Branch output is disabled for incomplete captures in this prototype.</p>` : ''}
  <p><button id="all">Select all</button><button id="none">Clear selection</button></p>${groups || '<p>No supported file changes between these checkpoints.</p>'}
  <button id="preview">Preview selection</button><label>Branch <input id="branch" type="text" value="chronicle/selection-${Date.now()}"></label><button id="apply" disabled>Create branch from preview</button><p id="status" role="status" aria-live="polite"></p><div id="output"></div>
  <script nonce="${nonce}">
    const api=acquireVsCodeApi();const boxes=[...document.querySelectorAll('input[type=checkbox]')];const apply=document.getElementById('apply');const status=document.getElementById('status');let busy=false;
    function selected(){return boxes.filter(b=>b.checked).map(b=>b.value)}
    function invalidate(){apply.disabled=true;document.getElementById('output').replaceChildren();}
    boxes.forEach(b=>b.addEventListener('change',()=>{if(b.dataset.parent){const parent=boxes.find(p=>p.value===b.dataset.parent);if(parent)parent.checked=false}if(b.dataset.hasGroups==='true')boxes.filter(child=>child.dataset.parent===b.value).forEach(child=>child.checked=false);invalidate()}));
    document.getElementById('all').onclick=()=>{boxes.forEach(b=>b.checked=true);invalidate()};document.getElementById('none').onclick=()=>{boxes.forEach(b=>b.checked=false);invalidate()};
    function send(type){if(busy)return;busy=true;apply.disabled=true;status.textContent='Working locally…';api.postMessage({type,selected:selected(),branch:document.getElementById('branch').value});}
    document.getElementById('preview').onclick=()=>send('preview');apply.onclick=()=>send('apply');
    window.addEventListener('message',event=>{busy=false;const m=event.data;status.textContent=m.message||'';if(m.type==='preview'){const out=document.getElementById('output');out.replaceChildren();for(const file of m.files){const h=document.createElement('h2');h.textContent=file.path;const p=document.createElement('pre');p.textContent=file.content===null?'File will be deleted':file.content;out.append(h,p)}apply.disabled=!m.files.length||${Boolean(diff.excluded.length)};}else apply.disabled=true;});
  </script></body></html>`;
}

function renderComparison(webview, comparison) {
  const nonce = crypto.randomBytes(20).toString('hex');
  const { first, second } = comparison;
  const fileRows = comparison.files.map(file => `<tr><th>${escape(file.path)}<br><small>${escape(file.status)}</small></th><td>${file.first ? `${escape(file.first.hash.slice(0, 12))} · ${escape(file.first.mode)}` : 'Not present'}</td><td>${file.second ? `${escape(file.second.hash.slice(0, 12))} · ${escape(file.second.mode)}` : 'Not present'}</td></tr>`).join('');
  const facts = operation => {
    const checks = operation.manifest.checks.length ? `<ul>${operation.manifest.checks.map(check => `<li>${escape(check.label)} — ${escape(check.outcome)} (exit ${escape(check.exitCode)}, ${escape(check.source)})</li>`).join('')}</ul>` : '<p>Check results: Not recorded</p>';
    const fixture = operation.fixtureEvidence;
    const replay = fixture ? `Bound fixture run ${escape(fixture.runId)}: ${escape(fixture.injectedFixtureCalls)} injected calls, ${escape(fixture.rejectedFixtureCalls)} rejected calls. Live tool activity: Unavailable.` : 'Bound fixture evidence: Unavailable. Live tool activity: Unavailable.';
    return `<section><h2>${escape(operation.branch)}</h2><p>Runtime ${escape(operation.manifest.environment.node)} · ${escape(operation.manifest.environment.platform)}/${escape(operation.manifest.environment.architecture)}</p>${checks}<p>Reported cost: ${operation.manifest.reportedCost === null ? 'Unavailable' : escape(operation.manifest.reportedCost)}</p><p>Capture gaps: ${escape(operation.manifest.captureCoverage.gaps)} · Excluded files: ${escape(operation.manifest.captureCoverage.excludedFiles)}</p><p>Selected changes: ${escape(operation.manifest.selectedChangeIds.length)}</p><p>${replay}</p></section>`;
  };
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'nonce-${nonce}';"><meta name="viewport" content="width=device-width, initial-scale=1"><style nonce="${nonce}">body{font-family:var(--vscode-font-family);color:var(--vscode-foreground);padding:24px;max-width:1200px;margin:auto}h1{font-size:26px}small{opacity:.75}p{line-height:1.5}.facts{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}table{border-collapse:collapse;width:100%;table-layout:fixed}th,td{border:1px solid var(--vscode-panel-border);padding:10px;text-align:left;vertical-align:top;overflow-wrap:anywhere}thead th{background:var(--vscode-editorGroupHeader-tabsBackground)}section{border:1px solid var(--vscode-panel-border);padding:12px 18px}@media(max-width:760px){.facts{grid-template-columns:1fr}}</style></head><body><h1>Saved branch comparison</h1><p>Read-only comparison of recorded outputs. No checks or agent runs were started.</p><div class="facts">${facts(first)}${facts(second)}</div><table><thead><tr><th>File · change</th><th>${escape(first.branch)} · saved result</th><th>${escape(second.branch)} · saved result</th></tr></thead><tbody>${fileRows || '<tr><td colspan="3">No files in either saved output.</td></tr>'}</tbody></table><p>Checks and cost are unavailable unless a manifest explicitly records them. File hashes compare saved bytes and modes.</p></body></html>`;
}

function activate(context) {
  const guarded = fn => async () => { try { await fn(); } catch (error) { vscode.window.showErrorMessage('Chronicle: ' + error.message); } };
  context.subscriptions.push(vscode.commands.registerCommand('chronicle.capture', guarded(async () => {
    const engine = await workspace(); if (!engine) return;
    const label = await vscode.window.showInputBox({ prompt: 'Checkpoint label. Only saved files are captured.', value: 'Before agent changes' });
    if (label === undefined) return;
    const cp = engine.capture(label);
    vscode.window.showInformationMessage(`Chronicle saved ${Object.keys(cp.files).length} files (${cp.excluded.length} excluded).`);
  })));
  context.subscriptions.push(vscode.commands.registerCommand('chronicle.undoOperation', guarded(async () => {
    const engine = await workspace(); if (!engine) return;
    const operations = engine.operations().filter(op => ['completed', 'undoing'].includes(op.state));
    if (!operations.length) throw new Error('No completed or interrupted Chronicle output undos are available.');
    const selected = await vscode.window.showQuickPick(operations.map(op => ({ label: op.branch, description: op.state + ' · ' + op.createdAt, detail: op.id, op })), { title: 'Choose Chronicle output to undo or resume' });
    if (!selected) return;
    const choice = await vscode.window.showWarningMessage(`Restore Chronicle-selected files in ${selected.op.branch}? The separate output workspace remains in place. Later edits, staged changes to selected files, or new commits make undo refuse.`, { modal: true }, 'Undo Chronicle output');
    if (choice !== 'Undo Chronicle output') return;
    const result = engine.undoOperation(selected.op.id);
    vscode.window.showInformationMessage(`Restored ${result.restoredPaths.length} selected paths in the Chronicle output workspace.`);
  })));
  context.subscriptions.push(vscode.commands.registerCommand('chronicle.compareOperations', guarded(async () => {
    const engine = await workspace(); if (!engine) return;
    const operations = engine.operations().filter(op => op.state === 'completed' && op.manifest?.schema === 1);
    if (operations.length < 2) throw new Error('Create at least two completed output branches with evidence manifests first.');
    const selected = await vscode.window.showQuickPick(operations.map(op => ({ label: op.branch, description: op.createdAt, detail: op.id, op })), { title: 'Choose exactly two saved branches to compare', canPickMany: true });
    if (!selected) return;
    if (!Array.isArray(selected) || selected.length !== 2) throw new Error('Choose exactly two saved branches.');
    const comparison = engine.compareOperations(selected[0].op.id, selected[1].op.id);
    const panel = vscode.window.createWebviewPanel('chronicle.compareOperations', 'Chronicle — Branch Comparison', vscode.ViewColumn.Beside, { enableScripts: false, localResourceRoots: [] });
    panel.webview.html = renderComparison(panel.webview, comparison);
    context.subscriptions.push(panel);
  })));
  context.subscriptions.push(vscode.commands.registerCommand('chronicle.review', guarded(async () => {
    const engine = await workspace(); if (!engine) return;
    const checkpoints = engine.list();
    if (checkpoints.length < 2) throw new Error('Capture at least two checkpoints: before and after changes.');
    const items = checkpoints.map(cp => ({ label: cp.label, description: cp.createdAt, detail: cp.id, cp }));
    const a = await vscode.window.showQuickPick(items, { title: 'Chronicle: starting checkpoint' }); if (!a) return;
    const b = await vscode.window.showQuickPick(items.filter(item => item.cp.id !== a.cp.id), { title: 'Chronicle: result checkpoint' }); if (!b) return;
    const diff = engine.compare(a.cp.id, b.cp.id);
    const panel = vscode.window.createWebviewPanel('chronicle.review', 'Chronicle — Review', vscode.ViewColumn.Beside, { enableScripts: true, localResourceRoots: [] });
    panel.webview.html = render(panel.webview, diff, a.cp, b.cp);
    let approvedSelection, running = false;
    const listener = panel.webview.onDidReceiveMessage(async message => {
      if (running) return;
      running = true;
      try {
        if (!vscode.workspace.isTrusted) throw new Error('Workspace trust changed.');
        if (!message || !['preview', 'apply'].includes(message.type)) throw new Error('Unknown review action');
        const preview = engine.preview(a.cp.id, b.cp.id, message.selected);
        const key = JSON.stringify([...preview.selected].sort());
        if (message.type === 'preview') {
          approvedSelection = key;
          await panel.webview.postMessage({ type: 'preview', files: preview.files, message: `Preview: ${preview.files.length} files. No model requests.` });
        } else {
          if (key !== approvedSelection) throw new Error('Preview the current selection before creating a branch.');
          const op = engine.createBranch(a.cp.id, b.cp.id, message.selected, message.branch);
          approvedSelection = undefined;
          await panel.webview.postMessage({ type: 'applied', message: `Created ${op.branch}\nWorkspace: ${op.target}\nFiles are uncommitted; the original workspace is unchanged.` });
          const choice = await vscode.window.showInformationMessage('Chronicle selection is ready in a separate workspace.', 'Open workspace');
          if (choice) await vscode.commands.executeCommand('vscode.openFolder', vscode.Uri.file(op.target), true);
        }
      } catch (error) { await panel.webview.postMessage({ type: 'error', message: error.message }); }
      finally { running = false; }
    });
    panel.onDidDispose(() => listener.dispose());
    context.subscriptions.push(panel, listener);
  })));
}

module.exports = { activate, render, renderComparison };
