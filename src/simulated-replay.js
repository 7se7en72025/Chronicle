'use strict';

const crypto = require('node:crypto');

const MAX_CASSETTE_BYTES = 1024 * 1024;
const MAX_CALLS = 256;
const SIMULATED_TOOLS = new Set(['fixture.issue.lookup', 'fixture.issue.search']);

function fail(code, message) {
  const error = new Error(message);
  error.code = code;
  throw error;
}

function canonicalJson(value, depth = 0) {
  if (depth > 64) fail('SIMULATED_REPLAY_INVALID_JSON', 'Simulated tool values exceed the nesting limit.');
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value);
  if (typeof value === 'number' && Number.isFinite(value)) return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map(item => canonicalJson(item, depth + 1)).join(',') + ']';
  if (value && typeof value === 'object' && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null)) {
    return '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + canonicalJson(value[key], depth + 1)).join(',') + '}';
  }
  fail('SIMULATED_REPLAY_INVALID_JSON', 'Simulated tool values must be plain JSON data.');
}

function digest(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function createSimulatedReplay(inputCassette) {
  canonicalJson(inputCassette);
  let serialized;
  try { serialized = JSON.stringify(inputCassette); }
  catch { fail('SIMULATED_REPLAY_INVALID_CASSETTE', 'Cassette must be serializable JSON.'); }
  if (typeof serialized !== 'string' || Buffer.byteLength(serialized, 'utf8') > MAX_CASSETTE_BYTES) {
    fail('SIMULATED_REPLAY_INVALID_CASSETTE', 'Cassette exceeds the 1 MiB limit.');
  }

  let cassette;
  try { cassette = JSON.parse(serialized); }
  catch { fail('SIMULATED_REPLAY_INVALID_CASSETTE', 'Cassette must be valid JSON.'); }
  if (!cassette || cassette.schema !== 1 || cassette.kind !== 'chronicle.simulated-tool-cassette' ||
      typeof cassette.fixtureId !== 'string' || !/^[a-zA-Z0-9._-]{1,80}$/.test(cassette.fixtureId) ||
      !Array.isArray(cassette.allowedTools) || !Array.isArray(cassette.calls) || cassette.calls.length > MAX_CALLS) {
    fail('SIMULATED_REPLAY_INVALID_CASSETTE', 'Unsupported simulated-tool cassette schema.');
  }

  const allowed = new Set(cassette.allowedTools);
  if (allowed.size !== cassette.allowedTools.length || allowed.size === 0 || [...allowed].some(tool => !SIMULATED_TOOLS.has(tool))) {
    fail('SIMULATED_REPLAY_INVALID_CASSETTE', 'Cassette contains an unrecognized or duplicate tool allowlist entry.');
  }
  const ids = new Set();
  for (const call of cassette.calls) {
    if (!call || typeof call !== 'object' || typeof call.id !== 'string' || !/^[a-zA-Z0-9._-]{1,80}$/.test(call.id) ||
        ids.has(call.id) || !allowed.has(call.tool) || !Object.hasOwn(call, 'input') || !call.input ||
        typeof call.input !== 'object' || Array.isArray(call.input) || !Object.hasOwn(call, 'response')) {
      fail('SIMULATED_REPLAY_INVALID_CASSETTE', 'Cassette has an invalid or duplicate call entry.');
    }
    ids.add(call.id);
    canonicalJson(call.input);
    canonicalJson(call.response);
  }

  let cursor = 0;
  return Object.freeze({
    fixtureId: cassette.fixtureId,
    invoke(tool, input) {
      if (typeof tool !== 'string' || !allowed.has(tool)) fail('SIMULATED_REPLAY_TOOL_NOT_ALLOWED', 'Tool is outside this fixture allowlist.');
      const expected = cassette.calls[cursor];
      if (!expected) fail('SIMULATED_REPLAY_EXHAUSTED', 'No recorded fixture response remains for this call.');
      let requestHash;
      try { requestHash = digest(canonicalJson(input)); }
      catch { fail('SIMULATED_REPLAY_UNMATCHED', 'Call did not match the next fixture event.'); }
      if (tool !== expected.tool || requestHash !== digest(canonicalJson(expected.input))) {
        fail('SIMULATED_REPLAY_UNMATCHED', 'Call did not match the next fixture event.');
      }
      cursor++;
      const responseJson = JSON.stringify(expected.response);
      return {
        response: JSON.parse(responseJson),
        evidence: {
          kind: 'injected-fixture', fixtureId: cassette.fixtureId, callId: expected.id, tool,
          requestHash, responseHash: digest(canonicalJson(expected.response))
        }
      };
    },
    assertComplete() {
      if (cursor !== cassette.calls.length) fail('SIMULATED_REPLAY_INCOMPLETE', 'Fixture replay ended before all recorded calls were consumed.');
      return { fixtureId: cassette.fixtureId, consumedCalls: cursor, status: 'complete' };
    },
    get position() { return cursor; }
  });
}

module.exports = { createSimulatedReplay, SIMULATED_TOOLS: Object.freeze([...SIMULATED_TOOLS]) };
