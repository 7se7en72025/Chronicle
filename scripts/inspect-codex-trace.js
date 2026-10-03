#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const { TextDecoder } = require('node:util');
const { inspectCodexTrace, MAX_TRACE_BYTES } = require('../src/codex-trace');
const { MAX_CASSETTE_BYTES } = require('../src/simulated-replay');

function readLimited(file, limit) {
  const before = fs.lstatSync(file, { bigint: true });
  if (!before.isFile() || before.size > BigInt(limit)) throw new Error('Invalid evidence file');
  const fd = fs.openSync(file, 'r');
  try {
    const opened = fs.fstatSync(fd, { bigint: true });
    if (!opened.isFile() || opened.dev !== before.dev || opened.ino !== before.ino ||
        opened.ctimeNs !== before.ctimeNs || opened.size > BigInt(limit)) throw new Error('Evidence file changed before read');
    const bytes = Buffer.alloc(Number(opened.size) + 1);
    let count = 0, read;
    while (count < bytes.length && (read = fs.readSync(fd, bytes, count, bytes.length - count, null)) > 0) count += read;
    const after = fs.fstatSync(fd, { bigint: true });
    if (count > limit || BigInt(count) !== opened.size || after.size !== opened.size ||
        after.mtimeNs !== opened.mtimeNs || after.ctimeNs !== opened.ctimeNs) throw new Error('Evidence file changed during read');
    return bytes.subarray(0, count);
  } finally { fs.closeSync(fd); }
}

function main(args) {
  if (args.length !== 2) throw new Error('Usage: inspect-codex-trace <codex-jsonl> <fixture-cassette-json>');
  const trace = readLimited(args[0], MAX_TRACE_BYTES);
  let cassette;
  try { cassette = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(readLimited(args[1], MAX_CASSETTE_BYTES))); }
  catch { throw new Error('Invalid fixture cassette JSON or evidence file'); }
  const result = inspectCodexTrace(trace, cassette);
  console.log(JSON.stringify(result, null, 2));
  if (result.status !== 'host-reported-match') process.exitCode = 2;
}

if (require.main === module) {
  try { main(process.argv.slice(2)); }
  catch (error) { console.error('Codex trace inspection failed: ' + error.message); process.exitCode = 1; }
}

module.exports = { main };
