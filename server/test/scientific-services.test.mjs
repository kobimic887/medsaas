// Scientific proxy leftovers: upstream 401 must be 502 (not a session logout),
// authz-shaped upstream 403 stays 403, and path params stay encoded/validated.
// Router only — auth middleware lives in server/index.js.
//
// Run: SERVER_RUNTIME=bun bun test/scientific-services.test.mjs

import http from 'node:http';
import express from 'express';

let passed = 0;
let failed = 0;

function check(label, condition, extra = '') {
  if (condition) {
    console.log(`  PASS ${label}`);
    passed += 1;
  } else {
    console.log(`  FAIL ${label} ${extra}`);
    failed += 1;
  }
}

function listen(server) {
  return new Promise((resolve, reject) => {
    server.listen(0, '127.0.0.1', () => resolve(server.address().port));
    server.on('error', reject);
  });
}

function close(server) {
  return new Promise((resolve) => server.close(() => resolve()));
}

let nextUpstream = { status: 200, body: { ok: true } };

const upstream = http.createServer((req, res) => {
  if (nextUpstream.drop) {
    req.socket.destroy();
    return;
  }
  res.writeHead(nextUpstream.status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(nextUpstream.body));
});

const upstreamPort = await listen(upstream);
process.env.GROMACS_API_BASE = `http://127.0.0.1:${upstreamPort}`;
process.env.GLIOBLASTOMA_API_BASE = `http://127.0.0.1:${upstreamPort}`;

const { default: router, relayUpstreamStatus } = await import('../routes/scientificServices.js');

const app = express();
app.use(express.json());
app.use(router);
const appServer = http.createServer(app);
const appPort = await listen(appServer);
const BASE = `http://127.0.0.1:${appPort}`;

console.log('scientificServices:\n');

check('relayUpstreamStatus maps upstream 401 → 502', relayUpstreamStatus(401) === 502);
check('relayUpstreamStatus keeps 403', relayUpstreamStatus(403) === 403);
check('relayUpstreamStatus keeps 400', relayUpstreamStatus(400) === 400);
check('relayUpstreamStatus keeps 200', relayUpstreamStatus(200) === 200);

{
  nextUpstream = { status: 401, body: { error: 'nvidia key rejected' } };
  const response = await fetch(`${BASE}/gromacs/info`);
  const body = await response.json();
  check('proxy remaps upstream 401 to 502', response.status === 502, `got ${response.status}`);
  check('proxy 401 remap keeps upstream payload', body.error === 'nvidia key rejected');
}

{
  nextUpstream = { status: 403, body: { error: 'quota' } };
  const response = await fetch(`${BASE}/gromacs/info`);
  check('proxy forwards upstream 403', response.status === 403, `got ${response.status}`);
}

{
  nextUpstream = { status: 200, body: { version: 'test' } };
  const response = await fetch(`${BASE}/gromacs/info`);
  const body = await response.json();
  check('proxy forwards upstream 200', response.status === 200 && body.version === 'test');
}

{
  const response = await fetch(`${BASE}/gromacs/workflows/not%20valid`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{}',
  });
  check('invalid workflow id is 400', response.status === 400, `got ${response.status}`);
}

{
  const response = await fetch(`${BASE}/gromacs/jobs/job$id`);
  check('invalid job id is 400', response.status === 400, `got ${response.status}`);
}

{
  nextUpstream = { drop: true };
  const response = await fetch(`${BASE}/glioblastoma/predict`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ smiles: 'C' }),
  });
  const body = await response.json();
  check('upstream down is 502', response.status === 502, `got ${response.status}`);
  check('upstream down names the failure', body.error === 'Upstream scientific service unavailable');
}

{
  // Unset bases are "not configured" — never a guessed localhost port (the old
  // GROMACS default was convertSTR's port, so health looked green).
  const saved = { g: process.env.GROMACS_API_BASE, b: process.env.GLIOBLASTOMA_API_BASE };
  delete process.env.GROMACS_API_BASE;
  process.env.GLIOBLASTOMA_API_BASE = '  ';
  let hits = 0;
  nextUpstream = { status: 200, body: { ok: true } };
  upstream.on('request', () => { hits += 1; });

  const info = await fetch(`${BASE}/gromacs/info`);
  const infoBody = await info.json();
  check('unset GROMACS is 503 not configured', info.status === 503 && infoBody.code === 'SERVICE_NOT_CONFIGURED', `got ${info.status}`);

  const predict = await fetch(`${BASE}/glioblastoma/predict`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ smiles: 'C' }),
  });
  check('blank glioblastoma base is 503 not configured', predict.status === 503, `got ${predict.status}`);

  const workflow = await fetch(`${BASE}/gromacs/workflows/minimize`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}',
  });
  check('unset GROMACS workflow is 503', workflow.status === 503, `got ${workflow.status}`);

  const health = await (await fetch(`${BASE}/platform/health`)).json();
  check('health reports not_configured for both', health.checks.gromacs.status === 'not_configured'
    && health.checks.glioblastoma.status === 'not_configured', JSON.stringify(health.checks));
  check('not-configured paths never contact any upstream', hits === 0, `hits=${hits}`);

  process.env.GROMACS_API_BASE = saved.g;
  process.env.GLIOBLASTOMA_API_BASE = saved.b;
  const restored = await fetch(`${BASE}/gromacs/info`);
  check('configured base is read per request', restored.status === 200, `got ${restored.status}`);
}

await close(appServer);
await close(upstream);

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
