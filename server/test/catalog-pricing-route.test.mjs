// Molecule checkout pricing route: original-catalog re-pricing, 409 review,
// stock-origin refusal, disabled /api/stock-offers. Stub upstream serves the
// original catalog GET /api/id/<code> only — any /api4/bas hit fails the run.
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

// Real per-compound catalog prices measured live 2026-09-13 from
// {ASINEX_API_BASE}/api/id/<code> (docs/DATA-STOCK-COMPOUNDS.md § Catalog pricing).
const CATALOG_ROWS = {
  'BAS 00293357': { id: 2, id_number: 'BAS 00293357', smiles_string: 'C#Cc1ccc(cc1)C#C', brutto_formula: 'C10 H6', price_1mg: 22, price_5mg: 66, price_10mg: 176 },
  'LAS 30881879': { id: 19009, id_number: 'LAS 30881879', smiles_string: 'Cc1ccc(cc1)C(=O)O', brutto_formula: 'C8 H8 O2', price_1mg: 20, price_5mg: 60, price_10mg: 160 },
};

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
    if (req.method === 'GET' && url.pathname.startsWith('/api/id/')) {
      const code = decodeURIComponent(url.pathname.slice('/api/id/'.length));
      const row = CATALOG_ROWS[code];
      res.writeHead(200, { 'Content-Type': 'application/json' });
      // Unknown codes answer 200 with an EMPTY body (measured upstream behavior).
      res.end(row ? JSON.stringify(row) : '');
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
        STRIPE_SECRET_KEY: 'sk_test_catalog_pricing_unused',
        STRIPE_WEBHOOK_SECRET: 'whsec_catalog_pricing_test_do_not_use',
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

    // ── stock-origin basket rows are refused explicitly ──────────────────────
    const stockCheckout = await fetch(`${BASE}/create-checkout-session-onetime`, {
      method: 'POST',
      headers: auth,
      body: JSON.stringify({
        cartItems: [{ source: 'stock', catalogId: 'ASN 33727025', amount: 1, totalPrice: 170, name: 'ASN 33727025' }],
      }),
    });
    const stockBody = await stockCheckout.json().catch(() => ({}));
    check(
      'stock-origin row → 400 MOLECULE_STOCK_ITEMS_UNSUPPORTED',
      stockCheckout.status === 400 && stockBody.code === 'MOLECULE_STOCK_ITEMS_UNSUPPORTED',
      `(got ${stockCheckout.status}) ${JSON.stringify(stockBody).slice(0, 160)}`,
    );
    check(
      'rejection names the offending row with a removal instruction',
      stockBody.unsupportedItems?.[0]?.catalogId === 'ASN 33727025' && /remove/i.test(stockBody.error || ''),
      JSON.stringify(stockBody).slice(0, 200),
    );
    check('stock rejection creates no Stripe session', stockBody.url === undefined && stockBody.sessionId === undefined);
    check('stock rejection made no upstream lookup', stub.requests.length === 0);

    // Legacy shape: a source-less row that carries the stockCode marker must
    // also be refused — never silently converted into a catalog purchase.
    const legacyStockCheckout = await fetch(`${BASE}/create-checkout-session-onetime`, {
      method: 'POST',
      headers: auth,
      body: JSON.stringify({
        cartItems: [{ catalogId: 'ASN 33727025', stockCode: 'ASN 33727025', amount: 5, totalPrice: 218 }],
      }),
    });
    const legacyStockBody = await legacyStockCheckout.json().catch(() => ({}));
    check(
      'source-less row with stockCode marker → 400 MOLECULE_STOCK_ITEMS_UNSUPPORTED',
      legacyStockCheckout.status === 400 && legacyStockBody.code === 'MOLECULE_STOCK_ITEMS_UNSUPPORTED',
      `(got ${legacyStockCheckout.status}) ${JSON.stringify(legacyStockBody).slice(0, 120)}`,
    );

    // ── catalog re-pricing + 409 review ──────────────────────────────────────
    const driftedCheckout = await fetch(`${BASE}/create-checkout-session-onetime`, {
      method: 'POST',
      headers: auth,
      body: JSON.stringify({
        cartItems: [
          { source: 'catalog', catalogId: 'BAS 00293357', amount: 5, totalPrice: 1, name: 'stale basket' },
          { catalogId: 'LAS 30881879', amount: 1, pricePerMg: 1, totalPrice: 1 },
        ],
      }),
    });
    const driftBody = await driftedCheckout.json().catch(() => ({}));
    check(
      'drifted basket → 409 MOLECULE_PRICES_CHANGED',
      driftedCheckout.status === 409 && driftBody.code === 'MOLECULE_PRICES_CHANGED',
      `(got ${driftedCheckout.status}) ${JSON.stringify(driftBody).slice(0, 160)}`,
    );
    check('409 re-priced from the measured catalog 5 mg price (66, not the stale 1)', driftBody.updatedCartItems?.[0]?.totalPrice === 66, JSON.stringify(driftBody.updatedCartItems || []).slice(0, 200));
    check('409 re-priced the legacy source-less row from /api/id too', driftBody.updatedCartItems?.[1]?.totalPrice === 20, JSON.stringify(driftBody.updatedCartItems || []).slice(0, 200));
    check('409 carries fresh total dollars', driftBody.totalAmount === 86);
    check('409 creates no Stripe session (no url/sessionId)', driftBody.url === undefined && driftBody.sessionId === undefined);
    check('409 kept the customer item fields', driftBody.updatedCartItems?.[0]?.name === 'stale basket' && driftBody.updatedCartItems?.[0]?.source === 'catalog');
    check(
      'pricing looked the codes up on the original catalog API',
      stub.requests.some((r) => r.method === 'GET' && r.path === '/api/id/BAS%2000293357')
        && stub.requests.some((r) => r.method === 'GET' && r.path === '/api/id/LAS%2030881879'),
      JSON.stringify(stub.requests.map((r) => `${r.method} ${r.path}`)),
    );

    // ── validation boundaries stay intact ────────────────────────────────────
    const qtyCheckout = await fetch(`${BASE}/create-checkout-session-onetime`, {
      method: 'POST',
      headers: auth,
      body: JSON.stringify({
        cartItems: [{ catalogId: 'BAS 00293357', amount: 1, quantity: 2, totalPrice: 22 }],
      }),
    });
    check('quantity other than 1 → 400', qtyCheckout.status === 400, `(got ${qtyCheckout.status})`);

    const qtyString = await fetch(`${BASE}/create-checkout-session-onetime`, {
      method: 'POST',
      headers: auth,
      body: JSON.stringify({
        cartItems: [{ catalogId: 'BAS 00293357', amount: 1, quantity: '1', totalPrice: 22 }],
      }),
    });
    check('quantity "1" as a string → 400 (only numeric 1)', qtyString.status === 400, `(got ${qtyString.status})`);

    const invalidSize = await fetch(`${BASE}/create-checkout-session-onetime`, {
      method: 'POST',
      headers: auth,
      body: JSON.stringify({
        cartItems: [{ catalogId: 'BAS 00293357', amount: 3, totalPrice: 99 }],
      }),
    });
    const invalidSizeBody = await invalidSize.json().catch(() => ({}));
    check(
      'unsupported pack size → 400',
      invalidSize.status === 400 && /package size/i.test(invalidSizeBody.error || ''),
      `(got ${invalidSize.status}) ${JSON.stringify(invalidSizeBody).slice(0, 160)}`,
    );

    const unknownCode = await fetch(`${BASE}/create-checkout-session-onetime`, {
      method: 'POST',
      headers: auth,
      body: JSON.stringify({
        cartItems: [{ catalogId: 'BAS 99999999', amount: 5, totalPrice: 66 }],
      }),
    });
    const unknownBody = await unknownCode.json().catch(() => ({}));
    check(
      'unknown catalog code → 400, not 409/Stripe',
      unknownCode.status === 400 && /catalog/i.test(unknownBody.error || ''),
      `(got ${unknownCode.status}) ${JSON.stringify(unknownBody).slice(0, 160)}`,
    );

    // ── invariants ───────────────────────────────────────────────────────────
    const events = await client.db(DB_NAME).collection('billing_events').find({}).toArray();
    check('no billing event written by any refused checkout', events.length === 0, `(found ${events.length})`);
    check(
      'checkout never called /api4/bas (pricing retirement is absolute)',
      stub.requests.every((r) => r.path !== '/api4/bas'),
      JSON.stringify(stub.requests.map((r) => r.path)),
    );

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
