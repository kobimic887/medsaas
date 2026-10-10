#!/usr/bin/env bun
// One loopback service for every macrocycle search on the scientific host:
//   /health, /v1/*   similarity (services/macrocycle-index, in process)
//   /graph/*         ID/exact/substructure + stock graph (serve.py child)
// The app points MACROCYCLE_SEARCH_BASE at <base> and OWNED_SEARCH_BASE at
// <base>/graph. Two chemistry engines remain on purpose: the similarity index
// was fingerprinted with RDKit WASM and the graph screens with Python RDKit, so
// moving either into the other runtime would change results. The child listens
// only on a private Unix socket; if it dies this process exits and systemd
// restarts both, so the service is never half up.
import http from 'node:http';
import { spawn } from 'node:child_process';
import { chmodSync, existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createIndexHandler, openIndexStore } from '../macrocycle-index/serve.mjs';

const MAX_GRAPH_BODY = 2_000_000; // serve.py's own request limit
// serve.py answers within its 35 s arrival budget; the app gives up at 40 s.
const GRAPH_TIMEOUT_MS = 38_000;

function sendJson(res, status, payload) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(payload));
}

function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    const tooLarge = () => Object.assign(new Error('Invalid request size'), { status: 400 });
    if (Number(req.headers['content-length']) > limit) { reject(tooLarge()); return; }
    const chunks = [];
    let size = 0;
    let settled = false;
    const settle = (fn, value) => { if (!settled) { settled = true; fn(value); } };
    req.on('data', (chunk) => {
      size += chunk.length;
      // Stop buffering but keep the socket so the 400 can still be delivered.
      if (size > limit) { settle(reject, tooLarge()); req.pause(); return; }
      chunks.push(chunk);
    });
    req.on('end', () => settle(resolve, Buffer.concat(chunks)));
    req.on('error', (error) => settle(reject, error));
    req.on('close', () => settle(reject, Object.assign(new Error('Client closed the request'), { status: 499 })));
  });
}

/** Forward one request to the graph child over its Unix socket. */
export function unixGraphRequest(socketPath, timeoutMs = GRAPH_TIMEOUT_MS) {
  return (method, path, body, signal) => new Promise((resolve, reject) => {
    if (!existsSync(socketPath)) { reject(Object.assign(new Error('Owned graph search is starting; retry shortly'), { status: 503 })); return; }
    // Explicit wall-clock timer: Bun does not emit socket idle 'timeout' for
    // Unix-socket requests, and a stalled child must not hold the caller.
    const timer = setTimeout(() => {
      reject(Object.assign(new Error('Search time budget exceeded; narrow the pattern or reduce the batch'), { status: 503 }));
      request.destroy();
    }, timeoutMs);
    const request = http.request({
      socketPath, path, method,
      headers: { Accept: 'application/json', ...(body.length ? { 'Content-Type': 'application/json', 'Content-Length': body.length } : {}) },
    }, (response) => {
      const chunks = [];
      response.on('data', (chunk) => chunks.push(chunk));
      response.on('end', () => { clearTimeout(timer); resolve({ status: response.statusCode, body: Buffer.concat(chunks) }); });
      response.on('error', (error) => { clearTimeout(timer); reject(error); });
    });
    request.on('error', (error) => { clearTimeout(timer); reject(error); });
    // The app gave up (its own 40 s cap or a closed tab): release this side.
    // serve.py still finishes inside its own 35 s arrival budget, as before.
    signal?.addEventListener('abort', () => { clearTimeout(timer); request.destroy(); reject(Object.assign(new Error('Client closed the request'), { status: 499 })); }, { once: true });
    request.end(body.length ? body : undefined);
  });
}

export function createCombinedServer({ indexHandler, graphRequest }) {
  return http.createServer(async (req, res) => {
    let pathname;
    try { ({ pathname } = new URL(req.url, 'http://127.0.0.1')); }
    catch { return sendJson(res, 400, { error: 'Bad request' }); }
    if (pathname !== '/graph' && !pathname.startsWith('/graph/')) return indexHandler(req, res);
    const aborted = new AbortController();
    // Node reports a caller that gave up; Bun's node:http does not (measured on
    // 1.3/1.4), so under Bun the 38 s timer and serve.py's 35 s budget bound it.
    res.on('close', () => { if (!res.writableEnded) aborted.abort(); });
    try {
      const body = await readBody(req, MAX_GRAPH_BODY);
      const upstream = await graphRequest(req.method, pathname.slice('/graph'.length) || '/', body, aborted.signal);
      res.writeHead(upstream.status, { 'Content-Type': 'application/json', 'Content-Length': upstream.body.length, 'Cache-Control': 'no-store' });
      res.end(upstream.body);
    } catch (error) {
      // Query text never reaches logs, matching serve.py's silent access log.
      if (error.status === 499 || res.headersSent || res.destroyed) return;
      sendJson(res, error.status || 503, { error: error.status ? error.message : 'Owned graph search is unavailable' });
      if (error.status === 400) res.on('finish', () => req.destroy());
    }
  });
}

async function main() {
  const host = process.env.BIND_HOST || '127.0.0.1';
  const port = Number(process.env.PORT || 8276);
  if (!['127.0.0.1', '::1'].includes(host) || !Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('Combined search must bind a valid loopback host and port');
  }
  const indexDir = process.env.MACROCYCLE_INDEX_DIR;
  if (!indexDir || !process.env.OWNED_GRAPH_DIR) throw new Error('MACROCYCLE_INDEX_DIR and OWNED_GRAPH_DIR are required');
  // systemd RuntimeDirectory= is private (0700) and removed on stop.
  const socketDir = process.env.RUNTIME_DIRECTORY || mkdtempSync(join(tmpdir(), 'pyxis-search-'));
  chmodSync(socketDir, 0o700);
  const socketPath = join(socketDir, 'graph.sock');
  rmSync(socketPath, { force: true });

  const store = await openIndexStore(indexDir);
  let stopping = false;
  const child = spawn(process.env.OWNED_SEARCH_PYTHON || '/usr/bin/python3', [join(dirname(fileURLToPath(import.meta.url)), 'serve.py')], {
    env: { ...process.env, OWNED_SEARCH_SOCKET: socketPath },
    stdio: ['ignore', 'inherit', 'inherit'],
  });
  child.on('exit', (code, signal) => {
    if (stopping) return;
    console.error(`Owned graph child exited (${signal || code}); restarting the combined service`);
    process.exit(1);
  });

  const server = createCombinedServer({ indexHandler: createIndexHandler(store), graphRequest: unixGraphRequest(socketPath) });
  server.on('error', (error) => { console.error(error); stopping = true; child.kill('SIGTERM'); process.exit(1); });
  server.listen(port, host, () => console.log(`Combined macrocycle search ready on ${host}:${port}`));
  const close = () => {
    if (stopping) return;
    stopping = true;
    child.kill('SIGTERM');
    server.close(() => store.close().finally(() => process.exit(0)));
    server.closeAllConnections?.();
  };
  process.on('SIGTERM', close);
  process.on('SIGINT', close);
}

if (import.meta.main) main().catch((error) => { console.error(error); process.exitCode = 1; });
