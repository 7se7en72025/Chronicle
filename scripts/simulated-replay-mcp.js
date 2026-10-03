'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { TextDecoder } = require('node:util');
const { createSimulatedReplayMcp, MAX_MESSAGE_BYTES } = require('../src/simulated-replay-mcp');
const { MAX_CASSETTE_BYTES } = require('../src/simulated-replay');

const cassettePath = process.argv[2] || path.join(__dirname, '..', 'fixtures', 'simulated-tools', 'issue-tracker.json');
const launchPath = process.argv[3];
const launchRunId = process.argv[4];
const evidencePath = process.argv[5];

function readCassetteBytes(file) {
  const before = fs.lstatSync(file, { bigint: true });
  if (!before.isFile() || before.size > BigInt(MAX_CASSETTE_BYTES)) throw new Error('Invalid cassette file');
  const fd = fs.openSync(file, 'r');
  try {
    const opened = fs.fstatSync(fd, { bigint: true });
    if (!opened.isFile() || opened.dev !== before.dev || opened.ino !== before.ino ||
        opened.ctimeNs !== before.ctimeNs || opened.size > BigInt(MAX_CASSETTE_BYTES)) throw new Error('Cassette changed before read');
    const bytes = Buffer.alloc(Number(opened.size) + 1);
    let count = 0, read;
    while (count < bytes.length && (read = fs.readSync(fd, bytes, count, bytes.length - count, null)) > 0) count += read;
    const after = fs.fstatSync(fd, { bigint: true });
    if (count > MAX_CASSETTE_BYTES || BigInt(count) !== opened.size || after.size !== opened.size ||
        after.mtimeNs !== opened.mtimeNs || after.ctimeNs !== opened.ctimeNs) throw new Error('Cassette changed during read');
    return bytes.subarray(0, count);
  } finally { fs.closeSync(fd); }
}

function writeMessage(output, message) {
  return message === null || output.write(JSON.stringify(message) + '\n');
}

function runStdioReplay({ input, output, errorOutput, cassette, onEvidence = () => {} }) {
  const server = createSimulatedReplayMcp(cassette, {
    onEvidence: evidence => {
      onEvidence(evidence);
      errorOutput.write(`Chronicle replay evidence ${JSON.stringify(evidence)}\n`);
    }
  });
  const decoder = new TextDecoder('utf-8', { fatal: true });
  let buffer = Buffer.alloc(0);
  let failed = false;
  let waitingForDrain = false;
  let inputEnded = false;
  let resolveRun;
  let settled = false;

  function finishRun(code) {
    if (settled) return;
    settled = true;
    resolveRun(code);
  }

  function failTransport(message, id = null, code = -32600) {
    writeMessage(output, { jsonrpc: '2.0', id, error: { code, message } });
    errorOutput.write(`${message}\n`);
    failed = true;
    input.destroy();
  }

  function processLine(line) {
    if (line.length && line[line.length - 1] === 13) line = line.subarray(0, -1);
    if (!line.length) {
      failTransport('Empty MCP message line.');
      return;
    }
    if (line.length > MAX_MESSAGE_BYTES) {
      failTransport('MCP message exceeds the 64 KiB limit.');
      return false;
    }
    let message;
    try { message = JSON.parse(decoder.decode(line)); }
    catch {
      failTransport('MCP message could not be parsed; replay stopped.', null, -32700);
      return false;
    }
    return writeMessage(output, server.handle(message));
  }

  function pauseUntilDrain() {
    waitingForDrain = true;
    input.pause();
    output.once('drain', () => {
      waitingForDrain = false;
      processBuffered();
      if (!waitingForDrain && !failed) input.resume();
    });
  }

  function processBuffered() {
    if (failed || waitingForDrain) return;
    let newline;
    while (!failed && (newline = buffer.indexOf(10)) !== -1) {
      const line = buffer.subarray(0, newline);
      buffer = buffer.subarray(newline + 1);
      if (!processLine(line)) {
        pauseUntilDrain();
        return;
      }
    }
    if (!failed && buffer.length > MAX_MESSAGE_BYTES) failTransport('MCP message exceeds the 64 KiB limit.');
    if (failed || !inputEnded) return;
    if (buffer.length) {
      const line = buffer;
      buffer = Buffer.alloc(0);
      if (!processLine(line)) { pauseUntilDrain(); return; }
    }
    try {
      const completion = server.finish();
      errorOutput.write(`Chronicle replay complete (${completion.consumedCalls} cassette calls).\n`);
      finishRun(0);
    } catch (finishError) {
      errorOutput.write(`Replay did not complete (${finishError.code || 'SIMULATED_REPLAY_INCOMPLETE'}).\n`);
      finishRun(1);
    }
  }

  return new Promise((resolve, reject) => {
    resolveRun = resolve;
    input.on('data', chunk => {
      if (failed) return;
      buffer = Buffer.concat([buffer, chunk]);
      processBuffered();
    });
    input.on('error', inputError => {
      errorOutput.write(`MCP input failed (${inputError.code || 'STREAM_ERROR'}).\n`);
      finishRun(1);
    });
    output.on('error', outputError => {
      failed = true;
      errorOutput.write(`MCP output failed (${outputError.code || 'STREAM_ERROR'}).\n`);
      input.destroy();
      finishRun(1);
    });
    input.on('end', () => {
      if (failed) return finishRun(1);
      inputEnded = true;
      processBuffered();
    });
    input.on('close', () => { if (failed || !inputEnded) finishRun(1); });
  });
}

async function main() {
  let evidenceFd;
  if (launchPath) {
    if (!/^[a-f0-9-]{36}$/.test(launchRunId || '')) throw new Error('INVALID_LAUNCH_ID');
    if (!evidencePath) throw new Error('MISSING_EVIDENCE_PATH');
    evidenceFd = fs.openSync(evidencePath, 'wx', 0o600);
    const fd = fs.openSync(launchPath, 'wx', 0o600);
    try { fs.writeFileSync(fd, JSON.stringify({ runId: launchRunId, pid: process.pid })); fs.fsyncSync(fd); }
    finally { fs.closeSync(fd); }
  }
  try {
    const cassetteBytes = readCassetteBytes(cassettePath);
    const cassette = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(cassetteBytes));
    const cassetteHash = crypto.createHash('sha256').update(cassetteBytes).digest('hex');
    let sequence = 0;
    const exitCode = await runStdioReplay({ input: process.stdin, output: process.stdout, errorOutput: process.stderr, cassette,
      onEvidence: evidence => {
        if (evidenceFd === undefined) return;
        if (++sequence > 257) throw new Error('MCP_EVIDENCE_LIMIT');
        fs.writeFileSync(evidenceFd, JSON.stringify({ ...evidence, runId: launchRunId, cassetteHash, sequence }) + '\n');
        fs.fsyncSync(evidenceFd);
      }
    });
    process.exitCode = exitCode;
  } finally {
    if (evidenceFd !== undefined) fs.closeSync(evidenceFd);
  }
}

if (require.main === module) {
  main().catch(error => {
    process.stderr.write(`Chronicle replay server failed to start (${error.code || 'INVALID_CASSETTE'}).\n`);
    process.exitCode = 1;
  });
}

module.exports = { runStdioReplay };
