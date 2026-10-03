#!/usr/bin/env node
'use strict';
const { Chronicle } = require('./engine');
const { normalizeAdapterEvent } = require('./event-contract');
const { TextDecoder } = require('node:util');

function recordHook(payload, options, adapter = 'claude-code') {
  const event = normalizeAdapterEvent(payload, adapter);
  // Never persist stdin wholesale: prompts, tool inputs, errors, and transcripts can contain secrets.
  const engine = new Chronicle(payload.cwd, options);
  try { return engine.capture([event.boundary, event.tool].filter(Boolean).join(' · '), event); }
  catch (error) { engine.recordGap(event, error); throw error; }
}

if (require.main === module) {
  let chunks = [], inputBytes = 0, oversized = false;
  process.stdin.on('data', chunk => {
    if (oversized) return;
    inputBytes += chunk.length;
    if (inputBytes > 1024 * 1024) { oversized = true; chunks = []; }
    else chunks.push(chunk);
  });
  process.stdin.on('end', () => {
    try {
      if (oversized) throw new Error('Hook payload exceeds 1 MiB');
      const input = new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks, inputBytes));
      recordHook(JSON.parse(input), undefined, process.argv[2] === 'codex' ? 'codex-cli' : 'claude-code');
    }
    catch (error) { console.error('Chronicle capture skipped: ' + error.message); }
    // Recorder failures do not reject the agent's action or inject model context.
  });
}

module.exports = { recordHook };
