// Routing contract for the combined staging search service. The real engines
// are covered by services/macrocycle-index/test.mjs and services/owned-search/test.py.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createCombinedServer, unixGraphRequest } from './combined.mjs';

const listen = (server, target) => new Promise((resolve) => server.listen(target, resolve));
const close = (server) => new Promise((resolve) => { server.closeAllConnections?.(); server.close(resolve); });

async function harness({ graph, timeoutMs } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'pyxis-combined-test-'));
  const socketPath = join(dir, 'graph.sock');
  const seen = [];
  let graphServer = null;
  if (graph) {
    graphServer = http.createServer((req, res) => {
      const chunks = [];
      req.on('data', (chunk) => chunks.push(chunk));
      req.on('end', () => { seen.push({ method: req.method, path: req.url, body: Buffer.concat(chunks).toString() }); graph(req, res); });
    });
    await listen(graphServer, socketPath);
  }
  const indexHandler = (req, res) => { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ engine: 'similarity', path: req.url })); };
  const server = createCombinedServer({ indexHandler, graphRequest: unixGraphRequest(socketPath, timeoutMs) });
  await listen(server, 0);
  const base = `http://127.0.0.1:${server.address().port}`;
  return {
    base, seen,
    async done() { await close(server); if (graphServer) await close(graphServer); rmSync(dir, { recursive: true, force: true }); },
  };
}

test('similarity paths stay on the in-process index; /graph/* reaches the graph child with its prefix removed', async () => {
  const h = await harness({ graph: (req, res) => { res.writeHead(req.url === '/search' ? 400 : 200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ engine: 'graph', path: req.url })); } });
  try {
    for (const path of ['/health', '/v1/datasets', '/v1/search/similarity?dataset_id=1']) {
      assert.deepEqual(await (await fetch(h.base + path)).json(), { engine: 'similarity', path });
    }
    const health = await fetch(`${h.base}/graph/health`);
    assert.deepEqual(await health.json(), { engine: 'graph', path: '/health' });
    const body = JSON.stringify({ source: 'virtual', mode: 'exact', query: 'C1CCCCCCCCCCC1', cap: 3 });
    const search = await fetch(`${h.base}/graph/search`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body });
    assert.equal(search.status, 400, 'graph status codes pass through unchanged');
    assert.deepEqual(await search.json(), { engine: 'graph', path: '/search' });
    assert.deepEqual(h.seen.at(-1), { method: 'POST', path: '/search', body });
  } finally { await h.done(); }
});

test('a graph child that is not up yet is reported as a retryable 503, never routed elsewhere', async () => {
  const h = await harness();
  try {
    const response = await fetch(`${h.base}/graph/search`, { method: 'POST', body: '{}' });
    assert.equal(response.status, 503);
    assert.match((await response.json()).error, /starting/);
    assert.equal((await fetch(`${h.base}/health`)).status, 200, 'similarity keeps serving');
  } finally { await h.done(); }
});

test('oversized graph bodies are refused before reaching the child', async () => {
  const h = await harness({ graph: (req, res) => { res.writeHead(200); res.end('{}'); } });
  try {
    const response = await fetch(`${h.base}/graph/search`, { method: 'POST', body: 'x'.repeat(2_000_001) });
    assert.equal(response.status, 400);
    assert.deepEqual(await response.json(), { error: 'Invalid request size' });
    assert.equal(h.seen.length, 0);
  } finally { await h.done(); }
});

test('a stalled graph child fails as an explicit time-budget 503', async () => {
  const h = await harness({ graph: () => {}, timeoutMs: 200 });
  try {
    const response = await fetch(`${h.base}/graph/search`, { method: 'POST', body: '{}' });
    assert.equal(response.status, 503);
    assert.match((await response.json()).error, /time budget/);
  } finally { await h.done(); }
});

