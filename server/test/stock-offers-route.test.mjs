// /api/stock-offers route: auth + validation + fixture-backed upstream.
// Run: SERVER_RUNTIME=bun bun test/stock-offers-route.test.mjs

import { spawn } from 'node:child_process';
import http from 'node:http';
import path from 'node:path';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { MongoClient } from 'mongodb';
import bcrypt from 'bcryptjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SERVER_DIR = path.resolve(__dirname, '..');
// Unique ports per run so a leftover child from a killed harness cannot steal health checks.
const PORT = 3219 + (process.pid % 200);
const STUB_PORT = 3320 + (process.pid % 200);
const BASE = `http://127.0.0.1:${PORT}`;
const JWT_SECRET = 'stock_offers_route_jwt_secret_at_least_32_chars';
const DB_NAME = 'medsaas_stock_offers_route_test';
const BUN_PATH = process.env.BUN_PATH || `${process.env.HOME}/.bun/bin/bun`;
const serverRuntime = process.env.SERVER_RUNTIME || 'bun';
const runtimeBin = serverRuntime === 'bun' ? BUN_PATH : process.execPath;

const FIXTURE = JSON.parse(
  readFileSync(path.join(__dirname, 'fixtures/api4-bas-stock-codes.json'), 'utf8'),
);

let passed = 0;
let failed = 0;
function check(label, cond, extra = '') {
  if (cond) {
    console.log(`  ✓ ${label}`);
    passed += 1;
  } else {
    console.log(`  ✗ ${label} ${extra}`);
    failed += 1;
  }
}

async function waitForHealth(timeoutMs = 40000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${BASE}/health`);
      if (res.ok) return true;
    } catch { /* not up */ }
    await new Promise((r) => setTimeout(r, 300));
  }
  return false;
}

function startCatalogStub() {
  const requests = [];
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, `http://127.0.0.1:${STUB_PORT}`);
    let body = '';
    for await (const chunk of req) body += chunk;
    const parsed = body ? JSON.parse(body) : {};
    requests.push({ path: url.pathname, body: parsed });
    if (url.pathname === '/api4/bas' && req.method === 'POST') {
      const requested = String(parsed.bas || '')
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
      const rows = FIXTURE.results.filter((row) => requested.includes(row.bas_code));
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(rows));
      return;
    }
    res.writeHead(404);
    res.end('not found');
  });
  return new Promise((resolve) => {
    server.listen(STUB_PORT, '127.0.0.1', () => resolve({ server, requests }));
  });
}

async function main() {
  let mongo;
  let client;
  let serverProc;
  let stub;
  let serverLog = '';
  try {
    stub = await startCatalogStub();
    mongo = await MongoMemoryServer.create();
    const uri = mongo.getUri(DB_NAME);
    client = new MongoClient(uri);
    await client.connect();

    serverProc = spawn(runtimeBin, ['index.js'], {
      cwd: SERVER_DIR,
      env: {
        ...process.env,
        PORT: String(PORT),
        MONGODB_URI: uri,
        JWT_SECRET,
        STRIPE_SECRET_KEY: 'sk_test_stock_offers_unused',
        STRIPE_WEBHOOK_SECRET: 'whsec_stock_offers_test_do_not_use',
        NODE_ENV: 'test',
        FRONTEND_DIST: '',
        NVIDIA_MOLMIM_API_KEY: '',
        ASINEX_API_BASE: `http://127.0.0.1:${STUB_PORT}`,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    serverProc.stdout.on('data', (d) => { serverLog += d.toString(); });
    serverProc.stderr.on('data', (d) => { serverLog += d.toString(); });

    const up = await waitForHealth();
    check('server became healthy', up);
    if (!up) {
      console.error(serverLog.slice(-2000));
      throw new Error('server-not-healthy');
    }

    const passwordHash = await bcrypt.hash('OffersPass1!', 10);
    await client.db(DB_NAME).collection('users').insertOne({
      username: 'offersuser',
      email: 'offers@example.com',
      password: passwordHash,
      verified: true,
      active: true,
      role: 'member',
      simulationTokens: 5,
      createdAt: new Date(),
    });

    const unauth = await fetch(`${BASE}/api/stock-offers`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ codes: ['ASN 33727025'] }),
    });
    check('offers without token → 401', unauth.status === 401, `(got ${unauth.status})`);

    const signinRes = await fetch(`${BASE}/api/signin`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'offersuser', password: 'OffersPass1!' }),
    });
    const signinBody = await signinRes.json().catch(() => ({}));
    check('signin ok', signinRes.status === 200 && typeof signinBody.token === 'string', `(got ${signinRes.status}) ${JSON.stringify(signinBody).slice(0, 120)}`);
    if (!signinBody.token) {
      throw new Error('signin-failed');
    }
    const auth = {
      Authorization: `Bearer ${signinBody.token}`,
      'Content-Type': 'application/json',
    };

    const bad = await fetch(`${BASE}/api/stock-offers`, {
      method: 'POST',
      headers: auth,
      body: JSON.stringify({}),
    });
    check('missing codes → 400', bad.status === 400, `(got ${bad.status})`);

    const ok = await fetch(`${BASE}/api/stock-offers`, {
      method: 'POST',
      headers: auth,
      body: JSON.stringify({
        codes: ['ASN 33727025', 'UNKNOWN 99999999', 'BAS 30906909'],
      }),
    });
    const body = await ok.json().catch(() => ({}));
    check('offers → 200', ok.status === 200, `(got ${ok.status}) ${JSON.stringify(body).slice(0, 120)}`);
    check('two offers resolved', body.offers?.length === 2);
    check('one unresolved', JSON.stringify(body.unresolvedCodes) === JSON.stringify(['UNKNOWN 99999999']));
    check(
      'ASN pack prices match fixture',
      body.offers?.find((o) => o.code === 'ASN 33727025')?.packs?.[0]?.priceUSD === 170,
    );
    check(
      'stub received bas list',
      stub.requests.some((r) => r.path === '/api4/bas' && String(r.body.bas).includes('ASN 33727025')),
    );

    console.log(`\nstock-offers route: ${passed} passed, ${failed} failed`);
    if (failed > 0) {
      console.error(serverLog.slice(-2000));
    }
  } catch (err) {
    console.error('Fatal:', err);
    console.error(serverLog.slice(-2000));
    failed += 1;
  } finally {
    try { serverProc?.kill('SIGKILL'); } catch { /* */ }
    try { await new Promise((resolve) => stub?.server.close(() => resolve())); } catch { /* */ }
    try { await client?.close(); } catch { /* */ }
    try { await mongo?.stop(); } catch { /* */ }
  }
  process.exit(failed > 0 ? 1 : 0);
}

main();
