#!/usr/bin/env node
'use strict';
const { Chronicle } = require('./engine');
const CLAUDE_EVENTS = new Set(['SessionStart', 'PreToolUse', 'PostToolUse', 'PostToolUseFailure']);
const CODEX_EVENTS = new Set(['SessionStart', 'SessionEnd', 'Interrupt', 'PreToolUse', 'PostToolUse']);

function recordHook(payload, options, adapter = 'claude-code') {
  if (!payload || typeof payload.cwd !== 'string') throw new Error('Unsupported hook payload');
  const source = adapter === 'codex-cli' ? 'codex-cli' : 'claude-code';
  if (!(source === 'codex-cli' ? CODEX_EVENTS : CLAUDE_EVENTS).has(payload.hook_event_name)) throw new Error('Unsupported hook payload');
  const clean = value => typeof value === 'string' ? value.slice(0, 200) : undefined;
  const event = {
    source, boundary: payload.hook_event_name,
    sessionId: clean(payload.session_id), toolUseId: clean(payload.tool_use_id), tool: clean(payload.tool_name),
    turnId: clean(payload.turn_id),
    attribution: 'observed-boundary-not-exclusive-authorship',
    status: payload.hook_event_name === 'PostToolUseFailure' ? 'failed' : source === 'codex-cli' && payload.hook_event_name === 'PostToolUse' ? 'observed' : payload.hook_event_name === 'PostToolUse' ? 'succeeded' : 'boundary'
  };
  // Never persist stdin wholesale: prompts, tool inputs, errors, and transcripts can contain secrets.
  const engine = new Chronicle(payload.cwd, options);
  try { return engine.capture([event.boundary, event.tool].filter(Boolean).join(' · '), event); }
  catch (error) { engine.recordGap(event, error); throw error; }
}

if (require.main === module) {
  let input = '', oversized = false;
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', chunk => { if (input.length + chunk.length > 1024 * 1024) { oversized = true; input = ''; } else if (!oversized) input += chunk; });
  process.stdin.on('end', () => {
    try { if (oversized) throw new Error('Hook payload exceeds 1 MiB'); recordHook(JSON.parse(input), undefined, process.argv[2] === 'codex' ? 'codex-cli' : 'claude-code'); }
    catch (error) { console.error('Chronicle capture skipped: ' + error.message); }
    // Recorder failures do not reject the agent's action or inject model context.
  });
}

module.exports = { recordHook };
