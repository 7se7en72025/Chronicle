'use strict';

const crypto = require('node:crypto');

const EVENTS = Object.freeze({
  'claude-code': new Set(['SessionStart', 'PreToolUse', 'PostToolUse', 'PostToolUseFailure']),
  'codex-cli': new Set(['SessionStart', 'SessionEnd', 'Interrupt', 'PreToolUse', 'PostToolUse'])
});

function boundedIdentifier(value, limit = 128) {
  return typeof value === 'string' && value.length > 0 && value.length <= limit && /^[a-zA-Z0-9._:-]+$/.test(value) ? value : undefined;
}

function normalizeAdapterEvent(payload, adapter) {
  if (!payload || typeof payload.cwd !== 'string' || !Object.hasOwn(EVENTS, adapter)) throw new Error('Unsupported hook payload');
  const boundary = payload.hook_event_name;
  if (!EVENTS[adapter].has(boundary)) throw new Error('Unsupported hook payload');

  const toolUseId = boundedIdentifier(payload.tool_use_id);
  const sessionId = boundedIdentifier(payload.session_id);
  const turnId = boundedIdentifier(payload.turn_id);
  const tool = boundedIdentifier(payload.tool_name, 80);
  const status = boundary === 'PostToolUseFailure' ? 'failed'
    : boundary === 'PostToolUse' && adapter === 'claude-code' ? 'succeeded'
      : boundary === 'PostToolUse' && adapter === 'codex-cli' ? 'observed'
        : 'boundary';
  const statusCertainty = status === 'succeeded' || status === 'failed' ? 'host-reported' : 'boundary-only';

  return {
    contract: 'chronicle.adapter-event', contractVersion: 1, eventId: crypto.randomUUID(),
    recordedAt: new Date().toISOString(), timestampSource: 'recorder',
    source: adapter, boundary, status, statusCertainty,
    sessionId, turnId, toolUseId, tool,
    attribution: 'observed-boundary-not-exclusive-authorship',
    privacy: 'metadata-only',
    references: { snapshotId: null, gapId: null }
  };
}

module.exports = { normalizeAdapterEvent };
