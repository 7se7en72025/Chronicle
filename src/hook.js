#!/usr/bin/env node
'use strict';
const { Chronicle } = require('./engine');
const EVENTS = new Set(['SessionStart', 'PreToolUse', 'PostToolUse', 'PostToolUseFailure']);

function recordHook(payload, options) {
  if (!payload || !EVENTS.has(payload.hook_event_name) || typeof payload.cwd !== 'string') throw new Error('Unsupported hook payload');
  const clean = value => typeof value === 'string' ? value.slice(0, 200) : undefined;
  const event = {
    source: 'claude-code', boundary: payload.hook_event_name,
    sessionId: clean(payload.session_id), toolUseId: clean(payload.tool_use_id), tool: clean(payload.tool_name),
    attribution: 'observed-boundary-not-exclusive-authorship',
    status: payload.hook_event_name === 'PostToolUseFailure' ? 'failed' : payload.hook_event_name === 'PostToolUse' ? 'succeeded' : 'boundary'
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
    try { if (oversized) throw new Error('Hook payload exceeds 1 MiB'); recordHook(JSON.parse(input)); }
    catch (error) { console.error('Chronicle capture skipped: ' + error.message); }
    // Recorder failures do not reject the agent's action or inject model context.
  });
}

module.exports = { recordHook };
