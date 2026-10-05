'use strict';

const crypto = require('node:crypto');
const { createSimulatedReplay, canonicalJson } = require('./simulated-replay');

const MAX_TRACE_BYTES = 4 * 1024 * 1024;
const MAX_TRACE_LINES = 10000;
const MAX_SERVER_EVIDENCE_BYTES = 256 * 1024;
const MAX_COMPLETION_BYTES = 1024;
const MAX_DIAGNOSTICS_BYTES = 1024 * 1024;
const SIDECAR_EVENT_KEYS = ['callId', 'cassetteHash', 'fixtureId', 'kind', 'requestHash', 'responseHash', 'runId', 'sequence', 'tool'];
const COMPLETION_KEYS = ['cassetteHash', 'consumedCalls', 'evidenceHash', 'kind', 'runId', 'schema'];

function hasExactKeys(value, expected) {
  return value && typeof value === 'object' && !Array.isArray(value) &&
    JSON.stringify(Object.keys(value).sort()) === JSON.stringify(expected);
}

function countHostDiagnostics(bytes) {
  if (!Buffer.isBuffer(bytes) || bytes.length > MAX_DIAGNOSTICS_BYTES) throw new Error('Codex diagnostics exceed the 1 MiB limit');
  const source = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  let ignoredBenignLine = false;
  return source.split(/\r?\n/).filter(line => {
    if (!line) return false;
    if (!ignoredBenignLine && line === 'Reading additional input from stdin...') {
      ignoredBenignLine = true;
      return false;
    }
    return true;
  }).length;
}

function sameJsonValue(left, right) {
  try { return canonicalJson(left) === canonicalJson(right); }
  catch { return false; }
}

function matchesServerEvidence(serverEvidence, expected, receiptText) {
  const { sidecarBytes, completionBytes, cassetteBytes } = serverEvidence;
  if (![sidecarBytes, completionBytes, cassetteBytes].every(Buffer.isBuffer) ||
      sidecarBytes.length > MAX_SERVER_EVIDENCE_BYTES || completionBytes.length > MAX_COMPLETION_BYTES ||
      (sidecarBytes.length !== 0 && sidecarBytes[sidecarBytes.length - 1] !== 10)) return false;
  let marker, lines;
  try {
    marker = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(completionBytes));
    lines = sidecarBytes.length === 0 ? [] :
      new TextDecoder('utf-8', { fatal: true }).decode(sidecarBytes).slice(0, -1).split('\n').map(line => JSON.parse(line));
  } catch { return false; }
  const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
  if (!hasExactKeys(marker, COMPLETION_KEYS) || receiptText !== JSON.stringify(marker) || marker.schema !== 1 ||
      marker.kind !== 'chronicle.fixture-server-completion' ||
      typeof marker.runId !== 'string' || !/^[a-f0-9-]{36}$/.test(marker.runId) ||
      marker.cassetteHash !== hash(cassetteBytes) || marker.evidenceHash !== hash(sidecarBytes) ||
      marker.consumedCalls !== expected.length || lines.length !== expected.length) return false;
  return lines.every((line, index) => {
    const wanted = expected[index];
    return hasExactKeys(line, SIDECAR_EVENT_KEYS) && line.kind === 'injected-fixture' && line.runId === marker.runId &&
      line.cassetteHash === marker.cassetteHash && line.sequence === index + 1 &&
      line.fixtureId === wanted.fixtureId && line.callId === wanted.callId &&
      line.tool === wanted.tool && line.requestHash === wanted.requestHash &&
      line.responseHash === wanted.responseHash;
  });
}

function classifyCoverage({ traceStructureValid, traceCallsMatchCassette, finishCalls, failedCalls,
  otherToolItems, hostErrorItems, pendingCalls, serverEvidence, serverEvidenceMatches,
  diagnosticsBytes, hostDiagnosticLines }) {
  const reasons = [];
  if (!traceStructureValid) reasons.push('trace-structure-invalid');
  if (!traceCallsMatchCassette) reasons.push('visible-cassette-calls-incomplete');
  if (failedCalls || pendingCalls) reasons.push('host-boundary-failed-or-pending');
  if (otherToolItems || hostErrorItems) reasons.push('other-host-tool-or-error-present');
  if (finishCalls !== 1 || serverEvidence === null) reasons.push('completion-receipt-unavailable');
  else if (serverEvidenceMatches !== true) reasons.push('completion-receipt-mismatch');
  if (diagnosticsBytes === null) reasons.push('host-diagnostics-unavailable');
  else if (hostDiagnosticLines !== 0) reasons.push('host-diagnostics-present');

  // Matching visible records still cannot prove that every host tool route was observed.
  return { classification: reasons.length === 0 ? 'partial-observed' : 'unknown', reasons };
}

function inspectCodexTrace(bytes, cassette, server = 'chronicle_replay', serverEvidence = null, diagnosticsBytes = null) {
  if (!Buffer.isBuffer(bytes) || bytes.length > MAX_TRACE_BYTES) throw new Error('Codex trace exceeds the 4 MiB limit');
  const source = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  if (!source.endsWith('\n')) throw new Error('Codex trace has an incomplete final line');
  const lines = source.slice(0, -1).split('\n');
  if (lines.length > MAX_TRACE_LINES) throw new Error('Codex trace has too many events');
  const replay = createSimulatedReplay(cassette);
  const expectedEvidence = [];
  const pending = new Map();
  let threadStarted = 0, turnStarted = 0, turnCompleted = 0, turnActive = false;
  let matchedCalls = 0, failedCalls = 0, otherToolItems = 0, hostErrorItems = 0, finishCalls = 0;
  let receiptText = null;
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
        if (!started || started.tool !== item.tool || !sameJsonValue(started.arguments, item.arguments)) {
          invalid = true;
          continue;
        }
        pending.delete(item.id);
        if (item.status !== 'completed') { failedCalls++; continue; }
        if (item.tool === 'fixture.replay.finish') {
          finishCalls++;
          if (finishCalls !== 1 || matchedCalls !== cassette.calls.length ||
              !item.arguments || typeof item.arguments !== 'object' || Array.isArray(item.arguments) ||
              Object.keys(item.arguments).length !== 0 ||
              !item.result || item.result.isError === true ||
              (item.result.structured_content !== undefined && item.result.structured_content !== null) ||
              !Array.isArray(item.result.content) || item.result.content.length !== 1 ||
              !item.result.content[0] || item.result.content[0].type !== 'text' ||
              typeof item.result.content[0].text !== 'string') invalid = true;
          else receiptText = item.result.content[0].text;
          continue;
        }
        if (finishCalls) { invalid = true; continue; }
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
          expectedEvidence.push(replay.invoke(item.tool, item.arguments).evidence);
          matchedCalls++;
        } catch { invalid = true; }
      } else if (item.type === 'error') hostErrorItems++;
      else if (!['agent_message', 'reasoning'].includes(item.type)) otherToolItems++;
    } else if (event.type !== 'thread.started' && event.type !== 'turn.started' && event.type !== 'turn.completed') invalid = true;
  }
  let traceCallsMatchCassette = false;
  try { replay.assertComplete(); traceCallsMatchCassette = true; } catch { /* Incomplete or rejected tool sequence. */ }
  const serverEvidenceMatches = serverEvidence === null ? null : matchesServerEvidence(serverEvidence, expectedEvidence, receiptText);
  const hostDiagnosticLines = diagnosticsBytes === null ? null : countHostDiagnostics(diagnosticsBytes);
  const hostReportedMatch = !invalid && threadStarted === 1 && turnStarted === 1 && turnCompleted === 1 &&
    pending.size === 0 && failedCalls === 0 && otherToolItems === 0 && hostErrorItems === 0 && traceCallsMatchCassette &&
    (serverEvidence === null ? finishCalls === 0 : finishCalls === 1) &&
    (serverEvidence === null ? hostDiagnosticLines === null || hostDiagnosticLines === 0 : hostDiagnosticLines === 0);
  const coverage = classifyCoverage({ traceStructureValid: !invalid, traceCallsMatchCassette,
    finishCalls, failedCalls, otherToolItems, hostErrorItems, pendingCalls: pending.size,
    serverEvidence, serverEvidenceMatches, diagnosticsBytes, hostDiagnosticLines });
  return {
    status: hostReportedMatch && serverEvidenceMatches === true ? 'host-server-evidence-consistent' :
      hostReportedMatch && serverEvidenceMatches === null ? 'host-reported-match' : 'review-required',
    matchedCalls, expectedCalls: cassette.calls.length, finishCalls, failedCalls, otherToolItems,
    hostErrorItems, pendingCalls: pending.size, traceStructureValid: !invalid, traceCallsMatchCassette, coverage,
    ...(serverEvidence !== null ? { serverEvidenceMatches } : {}),
    ...(diagnosticsBytes !== null ? { hostDiagnosticLines } : {})
  };
}

module.exports = { inspectCodexTrace, MAX_TRACE_BYTES, MAX_SERVER_EVIDENCE_BYTES, MAX_COMPLETION_BYTES, MAX_DIAGNOSTICS_BYTES };
