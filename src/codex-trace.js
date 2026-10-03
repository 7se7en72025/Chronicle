'use strict';

const { createSimulatedReplay } = require('./simulated-replay');

const MAX_TRACE_BYTES = 4 * 1024 * 1024;
const MAX_TRACE_LINES = 10000;

function inspectCodexTrace(bytes, cassette, server = 'chronicle_replay') {
  if (!Buffer.isBuffer(bytes) || bytes.length > MAX_TRACE_BYTES) throw new Error('Codex trace exceeds the 4 MiB limit');
  const source = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  if (!source.endsWith('\n')) throw new Error('Codex trace has an incomplete final line');
  const lines = source.slice(0, -1).split('\n');
  if (lines.length > MAX_TRACE_LINES) throw new Error('Codex trace has too many events');
  const replay = createSimulatedReplay(cassette);
  const pending = new Map();
  let threadStarted = 0, turnStarted = 0, turnCompleted = 0, turnActive = false;
  let matchedCalls = 0, failedCalls = 0, otherToolItems = 0, hostErrorItems = 0;
  let invalid = false;
  for (const line of lines) {
    let event;
    try { event = JSON.parse(line); } catch { throw new Error('Codex trace contains invalid JSON'); }
    if (!event || typeof event !== 'object' || Array.isArray(event)) { invalid = true; continue; }
    if (event.type === 'thread.started') {
      threadStarted++;
      if (threadStarted !== 1 || turnStarted) invalid = true;
    } else if (event.type === 'turn.started') {
      turnStarted++;
      if (threadStarted !== 1 || turnStarted !== 1 || turnCompleted) invalid = true;
      turnActive = true;
    } else if (event.type === 'turn.completed') {
      turnCompleted++;
      if (!turnActive || pending.size || turnCompleted !== 1) invalid = true;
      turnActive = false;
    } else if (event.type === 'turn.failed') invalid = true;
    else if (event.type === 'item.started' || event.type === 'item.completed') {
      const item = event.item;
      if (!item || typeof item !== 'object') { invalid = true; continue; }
      if (item.type === 'mcp_tool_call') {
        if (!turnActive) invalid = true;
        if (typeof item.id !== 'string' || item.server !== server || typeof item.tool !== 'string') {
          otherToolItems++;
          continue;
        }
        if (event.type === 'item.started') {
          if (pending.has(item.id) || item.status !== 'in_progress') invalid = true;
          else pending.set(item.id, { tool: item.tool, arguments: item.arguments });
          continue;
        }
        const started = pending.get(item.id);
        if (!started || started.tool !== item.tool || JSON.stringify(started.arguments) !== JSON.stringify(item.arguments)) {
          invalid = true;
          continue;
        }
        pending.delete(item.id);
        if (item.status !== 'completed') { failedCalls++; continue; }
        try {
          const expected = cassette.calls[matchedCalls];
          if (!expected || item.tool !== expected.tool ||
              !item.result || item.result.isError === true ||
              (item.result.structured_content !== undefined && item.result.structured_content !== null) ||
              !Array.isArray(item.result.content) || item.result.content.length !== 1 ||
              item.result.content[0].type !== 'text' || item.result.content[0].text !== JSON.stringify(expected.response)) {
            invalid = true;
            continue;
          }
          replay.invoke(item.tool, item.arguments);
          matchedCalls++;
        } catch { invalid = true; }
      } else if (item.type === 'error') hostErrorItems++;
      else if (!['agent_message', 'reasoning'].includes(item.type)) otherToolItems++;
    } else if (event.type !== 'thread.started' && event.type !== 'turn.started' && event.type !== 'turn.completed') invalid = true;
  }
  let traceCallsMatchCassette = false;
  try { replay.assertComplete(); traceCallsMatchCassette = true; } catch { /* Incomplete or rejected tool sequence. */ }
  const hostReportedMatch = !invalid && threadStarted === 1 && turnStarted === 1 && turnCompleted === 1 &&
    pending.size === 0 && failedCalls === 0 && otherToolItems === 0 && hostErrorItems === 0 && traceCallsMatchCassette;
  return {
    status: hostReportedMatch ? 'host-reported-match' : 'review-required',
    matchedCalls, expectedCalls: cassette.calls.length, failedCalls, otherToolItems,
    hostErrorItems, pendingCalls: pending.size, traceStructureValid: !invalid, traceCallsMatchCassette
  };
}

module.exports = { inspectCodexTrace, MAX_TRACE_BYTES };
