// Opt-in weekly stock availability snapshot through the REAL application server:
// /api/stock-search/similarity, /api/owned-search and /api/compound-shop with
// STOCK_AVAILABILITY_BASE set, against stub search and availability services and
// an ephemeral Mongo. No Stripe calls, production data or payments. The
// unconfigured path (variable unset = imported amounts) is the unchanged
// behavior already pinned by compound-shop-integration.test.mjs.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import http from 'node:http';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { MongoClient } from 'mongodb';
import jwt from 'jsonwebtoken';

const secret = 'stock_availability_route_secret_32_chars';
const port = 36100 + process.pid % 1000;
const base = `http://127.0.0.1:${port}`;
const user = { username: 'stock-buyer', userId: 'buyer-id', companyId: 'stock-company', role: 'member' };
const dbName = 'stock_availability_route';
const CODE = 'LAS 00000123';
let child; let mongo; let memory; let search; let availability; let serverLog = '';
let checks = 0;
function check(condition, label) { assert.ok(condition, label); checks++; console.log(`  ✓ ${label}`); }
async function request(route, body) {
  const headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${jwt.sign(user, secret, { expiresIn: '10m' })}` };
  const res = await fetch(base + route, { method: body === undefined ? 'GET' : 'POST', headers, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: res.status, body: await res.json() };
}
const listen = (server) => new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));

// The availability stub answers like services/owned-search/stockAvailability.mjs.
let snapshot = null; // null = inactive, Map = active, 'down' = failed (503)
const lookups = [];
try {
  search = http.createServer((req, res) => {
    res.setHeader('Content-Type', 'application/json');
    const row = { molecule_id: 123, canonical_smiles: 'CCO', similarity: 1, metadata: { MAIN_BAS: CODE, CURRENT_TOT_NETTO_MG: 8.3999996 } };
    res.end(JSON.stringify(req.method === 'POST' ? { results: [row], truncated: false } : { found: true, results: [row] }));
  });
  availability = http.createServer(async (req, res) => {
    let text = ''; for await (const chunk of req) text += chunk;
    lookups.push(JSON.parse(text).codes);
    res.setHeader('Content-Type', 'application/json');
    if (snapshot === 'down') { res.statusCode = 503; return res.end(JSON.stringify({ state: 'failed' })); }
    if (snapshot === null) return res.end(JSON.stringify({ state: 'inactive' }));
    const items = Object.fromEntries(JSON.parse(text).codes.filter((code) => snapshot.has(code)).map((code) => [code, snapshot.get(code)]));
    return res.end(JSON.stringify({ state: 'active', asOf: '2026-11-02', items }));
  });
  await Promise.all([listen(search), listen(availability)]);
  memory = await MongoMemoryServer.create();
  mongo = new MongoClient(memory.getUri(dbName));
  await mongo.connect();
  const db = mongo.db(dbName);
  await db.collection('users').insertOne({ ...user, active: true, verified: true, email: 'buyer@example.test', simulationTokens: 17 });
  await db.collection('companies').insertOne({ companyId: user.companyId, active: true, name: 'Stock fixture' });
  const runtime = process.env.SERVER_RUNTIME || 'bun';
  const searchBase = `http://127.0.0.1:${search.address().port}`;
  child = spawn(runtime === 'bun' ? (process.env.BUN_PATH || `${process.env.HOME}/.bun/bin/bun`) : process.execPath, ['index.js'], {
    cwd: fileURLToPath(new URL('..', import.meta.url)),
    env: { ...process.env, PORT: String(port), BIND_HOST: '127.0.0.1', MONGODB_URI: memory.getUri(dbName), JWT_SECRET: secret,
      NODE_ENV: 'test', PYXIS_DEMO_MODE: 'false', PYXIS_STAGING_MODE: 'false', STRIPE_SECRET_KEY: 'sk_test_no_network_calls',
      STOCK_SEARCH_BASE: searchBase, STOCK_SEARCH_DATASET_ID: '41', OWNED_SEARCH_BASE: searchBase,
      STOCK_AVAILABILITY_BASE: `http://127.0.0.1:${availability.address().port}`, FRONTEND_DIST: '', BASE_URL: base, FRONTEND_URL: base },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout.on('data', (d) => { serverLog += d; }); child.stderr.on('data', (d) => { serverLog += d; });
  let ready = false;
  for (let i = 0; i < 120; i++) { try { ready = (await fetch(base + '/health')).ok; } catch {} if (ready) break; await new Promise((resolve) => setTimeout(resolve, 200)); }
  check(ready, 'real application started with STOCK_AVAILABILITY_BASE');

  const searchPaths = {
    '/api/stock-search/similarity': () => request('/api/stock-search/similarity?smiles=CCO&threshold=1&limit=1'),
    '/api/owned-search (id)': () => request('/api/owned-search', { source: 'stock', mode: 'id', queries: [CODE], limit: 5 }),
    '/api/owned-search (multi)': () => request('/api/owned-search', { source: 'multi', sources: ['stock'], mode: 'id', queries: [CODE], limit: 5 }),
  };
  const offerOf = (response) => response.body.results?.[0]?.shopOffer;

  snapshot = null;
  for (const [name, run] of Object.entries(searchPaths)) {
    const response = await run();
    check(response.status === 200 && Math.abs(offerOf(response)?.availableMg - 8.3999996) < 1e-6, `${name}: inactive snapshot keeps the imported amount`);
  }
  snapshot = new Map([[CODE, 3]]);
  let offer;
  for (const [name, run] of Object.entries(searchPaths)) {
    lookups.length = 0;
    const response = await run();
    offer = offerOf(response);
    check(response.status === 200 && offer?.availableMg === 3 && offer.code === CODE && lookups.length === 1 && lookups[0].join() === CODE, `${name}: active snapshot amount replaces the imported one`);
  }
  snapshot = new Map();
  for (const [name, run] of Object.entries(searchPaths)) {
    const response = await run();
    check(response.status === 200 && response.body.results.length === 1 && offerOf(response) === null, `${name}: compound missing from the snapshot is listed without an offer`);
  }
  snapshot = 'down';
  for (const [name, run] of Object.entries(searchPaths)) {
    const response = await run();
    check(response.status === 200 && response.body.results.length === 1 && offerOf(response) === null, `${name}: service outage mints no stock offer (no fallback to stale amounts)`);
  }

  // Quote/checkout revalidation through the real router.
  const items = [{ offerToken: offer.token, amountMg: 2, quantity: 1 }];
  snapshot = new Map([[CODE, 3]]);
  const quoted = await request('/api/compound-shop/quote', { items });
  check(quoted.status === 200 && quoted.body.items[0].amountMg === 2, 'quote passes while the snapshot covers the pack');
  snapshot = new Map([[CODE, 1]]);
  const over = await request('/api/compound-shop/quote', { items });
  check(over.status === 409 && over.body.code === 'COMPOUND_STOCK_LIMIT', 'quote refused when the snapshot no longer covers the pack (409, not a logout)');
  snapshot = new Map();
  const checkout = { items, currency: 'usd', expectedTotalCents: quoted.body.totalCents, priceBookVersion: quoted.body.priceBookVersion, idempotencyKey: randomUUID() };
  const gone = await request('/api/compound-shop/checkout', checkout);
  check(gone.status === 409 && gone.body.code === 'COMPOUND_STOCK_UNAVAILABLE', 'checkout refused for a compound that left the snapshot');
  check(await db.collection('compound_orders').countDocuments() === 0, 'refused checkout stored no order');
  snapshot = 'down';
  const outage = await request('/api/compound-shop/quote', { items });
  check(outage.status === 503 && outage.body.code === 'STOCK_AVAILABILITY_UNAVAILABLE', 'quote during an outage is a retryable 503');
  snapshot = null;
  check((await request('/api/compound-shop/quote', { items })).status === 200, 'deactivated snapshot: quote falls back to the offer\'s own amount');
  console.log(`Stock availability route: ${checks} checks passed`);
} catch (error) {
  console.error(serverLog.slice(-2500)); throw error;
} finally {
  if (child) { child.kill('SIGTERM'); await new Promise((resolve) => { if (child.exitCode !== null) resolve(); else child.once('exit', resolve); }); }
  await mongo?.close(); await memory?.stop();
  for (const server of [search, availability]) if (server) await new Promise((resolve) => server.close(resolve));
}
