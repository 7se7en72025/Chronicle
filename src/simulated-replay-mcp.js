'use strict';

const { createSimulatedReplay } = require('./simulated-replay');

const PROTOCOL_VERSION = '2025-11-25';
const SERVER_NAME = 'chronicle-simulated-replay';
const SERVER_VERSION = '0.1.0';

const TOOL_DEFINITIONS = Object.freeze({
  'fixture.issue.lookup': {
    name: 'fixture.issue.lookup',
    description: 'Read a recorded issue response from the Chronicle fixture cassette. No live service is called.',
    inputSchema: {
      type: 'object', properties: { issueId: { type: 'string' } },
      required: ['issueId'], additionalProperties: false
    },
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false }
  },
  'fixture.issue.search': {
    name: 'fixture.issue.search',
    description: 'Read recorded issue search results from the Chronicle fixture cassette. No live service is called.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string' },
        limit: { type: 'integer', minimum: 1, maximum: 10 }
      },
      required: ['query', 'limit'], additionalProperties: false
    },
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false }
  }
});

function rpcError(id, code, message) {
  return { jsonrpc: '2.0', id, error: { code, message } };
}

function isRecord(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function createSimulatedReplayMcp(cassette, { onEvidence = () => {} } = {}) {
  const replay = createSimulatedReplay(cassette);
  const availableTools = cassette.allowedTools.map(name => TOOL_DEFINITIONS[name]);
  const availableNames = new Set(cassette.allowedTools);
  let phase = 'new';
  let stopped = false;
  let stopCode = null;

  function toolError(id, code, message) {
    return {
      jsonrpc: '2.0', id,
      result: {
        content: [{ type: 'text', text: message }],
        isError: true
      }
    };
  }

  function handle(message) {
    const attemptedToolCall = isRecord(message) && message.method === 'tools/call';
    if (!isRecord(message) || message.jsonrpc !== '2.0' || typeof message.method !== 'string' ||
        (Object.hasOwn(message, 'id') && !(typeof message.id === 'string' || (typeof message.id === 'number' && Number.isFinite(message.id))))) {
      if (attemptedToolCall) {
        stopped = true;
        stopCode = 'SIMULATED_REPLAY_INVALID_CALL';
      }
      return rpcError(null, -32600, 'Invalid JSON-RPC request.');
    }

    const hasId = Object.hasOwn(message, 'id');
    const id = hasId ? message.id : null;
    const params = message.params === undefined ? {} : message.params;

    if (message.method === 'notifications/initialized') {
      if (hasId) return rpcError(id, -32600, 'notifications/initialized must not include an id.');
      if (phase === 'awaiting-initialized') phase = 'ready';
      return null;
    }
    if (!hasId) {
      if (attemptedToolCall) {
        stopped = true;
        stopCode = 'SIMULATED_REPLAY_INVALID_CALL';
      }
      return null;
    }

    if (message.method === 'initialize') {
      if (phase !== 'new' || !isRecord(params) || typeof params.protocolVersion !== 'string' ||
          !isRecord(params.clientInfo) || typeof params.clientInfo.name !== 'string' ||
          typeof params.clientInfo.version !== 'string' || !isRecord(params.capabilities)) {
        return rpcError(id, -32602, 'Invalid initialize parameters.');
      }
      phase = 'awaiting-initialized';
      return {
        jsonrpc: '2.0', id,
        result: {
          protocolVersion: PROTOCOL_VERSION,
          capabilities: { tools: {} },
          serverInfo: { name: SERVER_NAME, version: SERVER_VERSION },
          instructions: 'Only allowlisted, read-only fixture tools are available. Tool calls consume the recorded cassette in order. Any mismatch stops replay; no live fallback exists.'
        }
      };
    }

    if (message.method === 'ping') return { jsonrpc: '2.0', id, result: {} };
    if (phase !== 'ready') return rpcError(id, -32002, 'Server not initialized.');

    if (message.method === 'tools/list') {
      return { jsonrpc: '2.0', id, result: { tools: availableTools } };
    }

    if (message.method === 'tools/call') {
      if (stopped) return toolError(id, stopCode || 'SIMULATED_REPLAY_STOPPED', 'Replay has stopped. No fixture response or live fallback was used.');
      if (!isRecord(params) || typeof params.name !== 'string' || !isRecord(params.arguments)) {
        stopped = true;
        stopCode = 'SIMULATED_REPLAY_INVALID_CALL';
        return rpcError(id, -32602, 'tools/call requires a tool name and object arguments.');
      }
      if (!availableNames.has(params.name)) {
        stopped = true;
        stopCode = 'SIMULATED_REPLAY_TOOL_NOT_ALLOWED';
        return rpcError(id, -32602, 'Tool is not available in this fixture cassette. Replay stopped; no live fallback was used.');
      }
      try {
        const call = replay.invoke(params.name, params.arguments);
        onEvidence(call.evidence);
        return {
          jsonrpc: '2.0', id,
          result: {
            content: [{ type: 'text', text: JSON.stringify(call.response) }],
            isError: false
          }
        };
      } catch (error) {
        stopped = true;
        stopCode = typeof error.code === 'string' ? error.code : 'SIMULATED_REPLAY_ERROR';
        return toolError(id, stopCode, `Replay stopped (${stopCode}). No live fallback was used.`);
      }
    }

    return rpcError(id, -32601, 'Method not found.');
  }

  function finish() {
    if (phase !== 'ready') {
      const error = new Error('MCP session ended before initialization completed.');
      error.code = 'MCP_NOT_INITIALIZED';
      throw error;
    }
    if (stopped) {
      const error = new Error('Simulated MCP replay stopped after a failed tool call.');
      error.code = stopCode;
      throw error;
    }
    return replay.assertComplete();
  }

  return Object.freeze({ handle, finish, get position() { return replay.position; }, get stopped() { return stopped; } });
}

module.exports = { createSimulatedReplayMcp, PROTOCOL_VERSION, MAX_MESSAGE_BYTES: 64 * 1024 };
