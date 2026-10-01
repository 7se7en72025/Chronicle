import http from 'node:http';
import path from 'node:path';
import { readFile, mkdir } from 'node:fs/promises';
import { ChronicleEngine } from './engine.mjs';
import { DEFAULT_FIX } from './fixture.mjs';
import { createBrowserRecorder } from './browser.mjs';

const port = Number(process.env.PORT || 4317);
const root = path.resolve(process.env.CHRONICLE_DATA_DIR || '.chronicle');
const production = process.argv.includes('--production');
const engine = new ChronicleEngine(root);
await engine.init();
let ready = false; let startupError = null; let recorder; let queue = Promise.resolve();
const json = (response, status, value) => { response.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); response.end(JSON.stringify(value)); };
const serialized = action => { const result = queue.then(action); queue = result.catch(() => {}); return result; };
async function body(request) {
  if (!request.headers['content-type']?.startsWith('application/json')) throw Object.assign(new Error('JSON content type required.'), { status: 415 });
  let content = ''; for await (const chunk of request) { content += chunk; if (content.length > 16000) throw Object.assign(new Error('Request is too large.'), { status: 413 }); }
  try { return JSON.parse(content || '{}'); } catch { throw Object.assign(new Error('Invalid JSON.'), { status: 400 }); }
}
const mime = { '.png': 'image/png', '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.json': 'application/json' };
const server = http.createServer(async (request, response) => {
  try {
    const url = new URL(request.url, `http://127.0.0.1:${port}`); const parts = url.pathname.split('/').filter(Boolean);
    if (request.method === 'POST') {
      const origin = request.headers.origin;
      if (origin && ![`http://127.0.0.1:${port}`, 'http://127.0.0.1:5173', `http://localhost:${port}`, 'http://localhost:5173'].includes(origin)) return json(response, 403, { error: 'Only local workspace requests are allowed.' });
    }
    if (url.pathname === '/api/health') return json(response, 200, { ready, startupError, browser: recorder?.error || 'available', adapter: 'controlled-coding-agent' });
    if (parts[0] === 'api') {
      if (!ready) return json(response, 503, { error: startupError || 'Preparing the recorded demo. Try again shortly.' });
      if (request.method === 'GET' && parts[1] === 'state') return json(response, 200, engine.summary());
      if (request.method === 'GET' && parts[1] === 'runs' && parts[2]) {
        if (parts[3] === 'capsule') return json(response, 200, engine.capsule(parts[2]));
        return json(response, 200, engine.getRun(parts[2]));
      }
      if (request.method === 'POST') {
        const input = await body(request);
        const result = await serialized(async () => {
          if (parts[1] === 'runs' && parts.length === 2) return engine.createRun();
          if (parts[1] === 'runs' && parts[3] === 'branch') return engine.branch(parts[2], Number(input.index), input.instruction, input.name || 'New experiment');
          if (parts[1] === 'runs' && parts[3] === 'test') return engine.saveTest(parts[2], input.name);
          if (parts[1] === 'runs' && parts[3] === 'comments') return engine.comment(parts[2], Number(input.index), input.body);
          if (parts[1] === 'tests' && parts[2] === 'run') return engine.runTests();
          throw Object.assign(new Error('Endpoint not found.'), { status: 404 });
        });
        return json(response, 200, result);
      }
      return json(response, 404, { error: 'Endpoint not found.' });
    }
    if (parts[0] === 'sandbox') {
      const cp = engine.getCheckpoint(parts[1], Number(parts[2])); const filename = parts[3];
      if (filename === 'fixture.js') {
        const data = structuredClone(cp.environment.database);
        if (url.searchParams.get('session') === 'anonymous' || request.headers.referer?.includes('session=anonymous')) data.session = null;
        response.writeHead(200, { 'Content-Type': 'text/javascript', 'Cache-Control': 'no-store' }); response.end(`window.__FIXTURE__ = ${JSON.stringify(data)};`); return;
      }
      if (!Object.hasOwn(cp.environment.files, filename)) return json(response, 404, { error: 'Sandbox file not found.' });
      response.writeHead(200, { 'Content-Type': mime[path.extname(filename)] || 'text/plain', 'Cache-Control': 'no-store', 'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'none'; img-src 'self' data:; object-src 'none'; base-uri 'none'" }); response.end(cp.environment.files[filename]); return;
    }
    if (parts[0] === 'artifacts') {
      if (parts.length !== 3 || !/^[a-f0-9-]{36}$/.test(parts[1]) || !/^\d+\.png$/.test(parts[2])) return json(response, 404, { error: 'Artifact not found.' });
      const bytes = await readFile(path.join(root, 'artifacts', parts[1], parts[2])); response.writeHead(200, { 'Content-Type': 'image/png', 'Cache-Control': 'private, max-age=3600' }); response.end(bytes); return;
    }
    if (production) {
      const relative = decodeURIComponent(url.pathname).replace(/^\/+/, '');
      const filename = relative && relative.includes('.') ? path.resolve('dist', relative) : path.resolve('dist/index.html');
      if (!filename.startsWith(path.resolve('dist') + path.sep)) return json(response, 403, { error: 'Unsupported path.' });
      const bytes = await readFile(filename); response.writeHead(200, { 'Content-Type': mime[path.extname(filename)] || 'application/octet-stream' }); response.end(bytes); return;
    }
    json(response, 404, { error: 'Open the interface at http://127.0.0.1:5173.' });
  } catch (error) { json(response, error.status || (error.code === 'ENOENT' ? 404 : 500), { error: error.message }); }
});
server.listen(port, '127.0.0.1', async () => {
  console.log(`Chronicle API: http://127.0.0.1:${port}`);
  try {
    await mkdir(root, { recursive: true });
    recorder = await createBrowserRecorder(root, `http://127.0.0.1:${port}`);
    engine.capture = recorder.capture;
    // A previous interrupted experiment is visible as interrupted, never as a verified result.
    for (const run of engine.state.runs) if (run.status === 'running') run.status = 'interrupted';
    if (!engine.state.runs.length) {
      const original = await engine.createRun();
      await engine.branch(original.id, 2, DEFAULT_FIX, 'Preserve authentication');
    }
    await engine.persist(); ready = true;
    console.log('Chronicle ready. ' + (recorder.error || 'Real browser snapshots enabled.'));
  } catch (error) { startupError = error.message; console.error(error); }
});
async function shutdown() { await recorder?.close(); server.close(() => process.exit(0)); }
process.on('SIGINT', shutdown); process.on('SIGTERM', shutdown);
