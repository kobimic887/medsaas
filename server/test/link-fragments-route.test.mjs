import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import http from 'node:http';
import test from 'node:test';
import express from 'express';
import { parseSdf, writeSdf } from '../../services/link-fragments/sdf.mjs';
import { createLinkFragmentsRouter } from '../routes/linkFragments.js';

test('real Express inspection, validation, availability and upstream session-status translation', async () => {
  const input = await readFile(new URL('../../services/link-fragments/fixtures/query.sdf', import.meta.url), 'utf8');
  const parsed = parseSdf(input);
  parsed[0].title = 'First fragment'; parsed[1].title = 'Second fragment';
  const sdf = parsed.map(writeSdf).join('');
  const upstreamRequests = [];
  const upstream = http.createServer(async (req, res) => {
    let body = ''; for await (const chunk of req) body += chunk;
    upstreamRequests.push({ url: req.url, body });
    res.setHeader('Content-Type', 'application/json');
    if (req.url.startsWith('/unauthorized')) { res.statusCode = 401; res.end(JSON.stringify({ error: 'Scientific credentials rejected' })); }
    else if (req.url === '/status') res.end(JSON.stringify({ available: true, records: 2, pairs: 2, method: 'fixture', limitations: ['fixture only'] }));
    else res.end(JSON.stringify({ results: [], candidatesScanned: 1, candidatesAvailable: 2, truncated: true }));
  });
  await new Promise(resolve => upstream.listen(0, '127.0.0.1', resolve));
  const app = express();
  app.use(express.json({ limit: '2mb' }));
  app.use('/unconfigured', createLinkFragmentsRouter());
  const upstreamUrl = `http://127.0.0.1:${upstream.address().port}`;
  app.use('/ready', createLinkFragmentsRouter({ baseUrl: upstreamUrl }));
  app.use('/bad-auth', createLinkFragmentsRouter({ baseUrl: `${upstreamUrl}/unauthorized` }));
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const post = (url, body) => fetch(base + url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  try {
    assert.equal((await fetch(`${base}/unconfigured/status`)).status, 503);
    const inspectedResponse = await post('/unconfigured/inspect', { sdf });
    const inspected = await inspectedResponse.json();
    assert.equal(inspectedResponse.status, 200, JSON.stringify(inspected));
    assert.deepEqual(inspected.fragments.map(fragment => fragment.name), ['First fragment', 'Second fragment']);
    assert.equal(inspected.fragments.length, 2);
    const first = inspected.fragments[0].atoms[0];
    assert.deepEqual(first, { number: 1, element: parsed[0].atoms[0].element, x: parsed[0].atoms[0].xyz[0], y: parsed[0].atoms[0].xyz[1], z: parsed[0].atoms[0].xyz[2] });
    assert.equal((await post('/ready/inspect', { sdf: writeSdf(parsed[0]) })).status, 400);
    assert.equal((await post('/ready/inspect', { sdf: sdf.replaceAll('3D', '2D') })).status, 400);
    assert.equal((await post('/ready/inspect', { sdf: sdf.replaceAll('V2000', 'V3000') })).status, 400);
    assert.equal((await post('/ready/inspect', { sdf: 'x'.repeat(800001) })).status, 400);
    for (const attachmentAtoms of [[0, 1], [1, 201], [1.5, 1], [1], ['1', 1]]) assert.equal((await post('/ready/search', { sdf, attachmentAtoms })).status, 400);
    assert.equal(upstreamRequests.length, 0, 'invalid local inputs never reach the scientific service');
    assert.equal((await post('/unconfigured/search', { sdf, attachmentAtoms: [1, 1] })).status, 503);
    const status = await fetch(`${base}/ready/status`);
    assert.equal(status.status, 200);
    assert.equal((await status.json()).records, 2);
    const results = await post('/ready/search', { sdf, attachmentAtoms: [1, 1], maxRmsd: 0.75, limit: 10 });
    assert.equal(results.status, 200);
    assert.equal((await results.json()).truncated, true);
    assert.deepEqual(JSON.parse(upstreamRequests.at(-1).body), { sdf, attachmentAtoms: [1, 1], maxRmsd: 0.75, limit: 10 });
    assert.equal((await fetch(`${base}/bad-auth/status`)).status, 502, 'scientific auth refusal must not log out the application session');
  } finally {
    server.closeAllConnections(); upstream.closeAllConnections();
    await Promise.all([new Promise(resolve => server.close(resolve)), new Promise(resolve => upstream.close(resolve))]);
  }
});
