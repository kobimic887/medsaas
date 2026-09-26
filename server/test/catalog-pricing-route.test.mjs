// Catalog independence route contract. Full staging uses the real server,
// isolated fixture Mongo and an HTTP sentinel. Every supplier catalog alias
// and molecule checkout shape must refuse locally, including company overrides.
// Run: SERVER_RUNTIME=bun bun test/catalog-pricing-route.test.mjs

import { spawn } from 'node:child_process';
import http from 'node:http';
import path from 'node:path';
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
const JWT_SECRET = 'catalog_pricing_route_jwt_secret_32chars_xx';
const DB_NAME = 'medsaas_catalog_pricing_route_test';
const BUN_PATH = process.env.BUN_PATH || `${process.env.HOME}/.bun/bin/bun`;
const serverRuntime = process.env.SERVER_RUNTIME || 'bun';
const runtimeBin = serverRuntime === 'bun' ? BUN_PATH : process.execPath;

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
    requests.push({ method: req.method, path: url.pathname, body: body ? JSON.parse(body) : {} });
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
        STRIPE_SECRET_KEY: 'sk_test_catalog_pricing_unused',
        STRIPE_WEBHOOK_SECRET: 'whsec_catalog_pricing_test_do_not_use',
        NODE_ENV: 'test',
        PYXIS_DEMO_MODE: 'false',
        PYXIS_STAGING_MODE: 'true',
        ASINEX_DOCKING_API_URL: 'https://services.asinex.com:8000/docking',
        DIFFDOCK_API_URL: 'https://services.asinex.com:58000/molecular-docking/diffdock/generate',
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

    const passwordHash = await bcrypt.hash('CatalogPass1!', 10);
    await client.db(DB_NAME).collection('users').insertOne({
      username: 'cataloguser',
      email: 'catalog@example.com',
      password: passwordHash,
      verified: true,
      active: true,
      role: 'member',
      simulationTokens: 5,
      createdAt: new Date(),
    });

    const stockOffersUnauth = await fetch(`${BASE}/api/stock-offers`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ codes: ['ASN 33727025'] }),
    });
    check('stock-offers without token → 401 (unchanged auth)', stockOffersUnauth.status === 401, `(got ${stockOffersUnauth.status})`);

    const signinRes = await fetch(`${BASE}/api/signin`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'cataloguser', password: 'CatalogPass1!' }),
    });
    const signinBody = await signinRes.json().catch(() => ({}));
    check('signin ok', signinRes.status === 200 && typeof signinBody.token === 'string', `(got ${signinRes.status})`);
    if (!signinBody.token) throw new Error('signin-failed');
    const auth = {
      Authorization: `Bearer ${signinBody.token}`,
      'Content-Type': 'application/json',
    };

    // ── /api/stock-offers is an explicit refusal, not a quote source ─────────
    const offers = await fetch(`${BASE}/api/stock-offers`, {
      method: 'POST',
      headers: auth,
      body: JSON.stringify({ codes: ['ASN 33727025'] }),
    });
    const offersBody = await offers.json().catch(() => ({}));
    check('stock-offers → 503 STOCK_OFFERS_DISABLED', offers.status === 503 && offersBody.code === 'STOCK_OFFERS_DISABLED', `(got ${offers.status}) ${JSON.stringify(offersBody).slice(0, 120)}`);
    check('stock-offers resolution made no upstream call', stub.requests.length === 0, `(stub saw ${stub.requests.length})`);

    const retiredPaths = [
      ['GET', '/api/all/0_10'], ['GET', '/api/exact/CCO'], ['GET', '/api/id/BAS1'],
      ['GET', '/api/asinex/all/0_10'], ['GET', '/api/asinex/id/BAS1'],
      ['GET', '/api/asinex/exact/CCO'], ['GET', '/api/asinex/substructure/0_10/CCO'],
      ['POST', '/api/asinex/search'], ['GET', '/api/asinex/health'],
      ...['bas', 'structure', 'substructure', 'similarity', 'mw'].map((name) => ['POST', `/api/api4/${name}`]),
      ['POST', '/api/shop'], ['GET', '/api4/similarity'],
      ['POST', '/API/ASINEX/SEARCH/'], ['GET', '/api/asinex/future-alias'],
    ];
    for (const [method, route] of retiredPaths) {
      const response = await fetch(`${BASE}${route}`, { method, headers: auth });
      const data = await response.json();
      check(`${method} ${route} refuses locally`, response.status === 503 && data.code === 'CATALOG_RETIRED');
    }
    for (const body of [
      { cartItems: [{ source: 'catalog', catalogId: 'BAS 00293357', amount: 1, totalPrice: 22 }] },
      { cartItems: [{ source: 'stock', stockCode: 'ASN1' }] },
      { cartItems: [{ catalogId: 'LAS1' }] },
      { description: 'legacy molecule total', totalAmount: 1 },
      { cartItems: [], description: 'empty cart bypass', totalAmount: 1 },
    ]) {
      const response = await fetch(`${BASE}/create-checkout-session-onetime`, {
        method: 'POST', headers: auth, body: JSON.stringify(body),
      });
      const data = await response.json();
      check('every molecule checkout shape refuses before Stripe', response.status === 503 && data.code === 'CATALOG_RETIRED' && !data.url);
    }
    const unauth = await fetch(`${BASE}/api/asinex/all/0_10`);
    check('retired catalog keeps missing-session 401', unauth.status === 401);

    // A stored company override cannot revive the catalog or supplier compute.
    const company = await client.db(DB_NAME).collection('companies').insertOne({
      name: 'Override company', active: true,
      ligandServiceConfig: {
        catalogApiBase: `http://127.0.0.1:${STUB_PORT}/company-catalog`,
        dockingApiUrl: 'https://SERVICES.ASINEX.COM.:8000/docking',
        diffdockApiUrl: 'https://services.asinex.com:58000/diffdock',
      },
    });
    await client.db(DB_NAME).collection('users').updateOne({ username: 'cataloguser' }, { $set: { companyId: company.insertedId.toString() } });
    const overridden = await fetch(`${BASE}/api/asinex/id/BAS1`, { headers: auth });
    check('company catalog override cannot enable supplier requests', overridden.status === 503 && (await overridden.json()).code === 'CATALOG_RETIRED');
    for (const [method, route, body] of [
      ['GET', '/api/simulation?pdbid=1abc&smiles=CCO', null],
      ['POST', '/api/simulation', { pdbid: '1abc', smiles: 'CCO' }],
      ['POST', '/api/diffdock/generate', { protein: '1abc', ligand: 'CCO' }],
    ]) {
      const response = await fetch(`${BASE}${route}`, { method, headers: auth, ...(body ? { body: JSON.stringify(body) } : {}) });
      const data = await response.json();
      check(`${method} ${route} refuses supplier compute before credits`, response.status === 503 && data.code === 'SUPPLIER_PROVIDER_RETIRED', JSON.stringify(data));
    }
    const user = await client.db(DB_NAME).collection('users').findOne({ username: 'cataloguser' });
    check('refused science preserves credit balance', user.simulationTokens === 5);
    check('zero supplier catalog HTTP requests, including overrides', stub.requests.length === 0, JSON.stringify(stub.requests));
    const events = await client.db(DB_NAME).collection('billing_events').countDocuments();
    check('zero billing events for refused molecule baskets', events === 0);

    console.log(`\ncatalog-pricing route: ${passed} passed, ${failed} failed`);
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
