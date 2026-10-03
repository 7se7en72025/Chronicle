'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { TextDecoder } = require('node:util');
const { createSimulatedReplayMcp, MAX_MESSAGE_BYTES } = require('../src/simulated-replay-mcp');

const cassettePath = process.argv[2] || path.join(__dirname, '..', 'fixtures', 'simulated-tools', 'issue-tracker.json');

function writeMessage(output, message) {
  return message === null || output.write(JSON.stringify(message) + '\n');
}

function runStdioReplay({ input, output, errorOutput, cassette }) {
  const server = createSimulatedReplayMcp(cassette, {
    onEvidence: evidence => errorOutput.write(`Chronicle replay evidence ${JSON.stringify(evidence)}\n`)
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
  const cassette = JSON.parse(fs.readFileSync(cassettePath, 'utf8'));
  const exitCode = await runStdioReplay({ input: process.stdin, output: process.stdout, errorOutput: process.stderr, cassette });
  process.exitCode = exitCode;
}

if (require.main === module) {
  main().catch(error => {
    process.stderr.write(`Chronicle replay server failed to start (${error.code || 'INVALID_CASSETTE'}).\n`);
    process.exitCode = 1;
  });
}

module.exports = { runStdioReplay };
