import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import express from 'express';
import jwt from 'jsonwebtoken';
import { isRetiredSupplierUrl, refuseRetiredCatalog } from '../utils/catalogAccessPolicy.js';
import { getPlan, buildPlanCheckoutSessionParams } from '../utils/planCheckout.js';
import { createStagingDemoRouter } from '../routes/stagingDemo.js';

for (const url of [
  'https://asinex.com', 'https://SERVICES.ASINEX.COM.:58000/diffdock',
  'http://dev.asinex.com:58181', 'https://stock.asinex.com/api/Shop',
]) assert.equal(isRetiredSupplierUrl(url), true, url);
for (const url of ['http://127.0.0.1:8000/dock', 'https://compute.pyxis-discovery.com', 'https://asinex.com.example.test']) {
  assert.equal(isRetiredSupplierUrl(url), false, url);
}

// Execute the actual registered one-time checkout handler against a fake Stripe
// adapter. A valid credit pack must still create a server-priced session, while
// a legacy cart or arbitrary client total must never reach that adapter.
const index = readFileSync(new URL('../index.js', import.meta.url), 'utf8');
const registration = index.indexOf("app.post('/create-checkout-session-onetime'");
const start = index.indexOf('async (req, res) => {', registration) + 'async (req, res) => {'.length;
const end = index.indexOf('\n});', start);
let sessions = [];
let events = [];
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
const handler = new AsyncFunction('req', 'res', 'getPublicAppUrl', 'getPlan', 'stripe', 'buildPlanCheckoutSessionParams', 'billingEventsCollection', 'refuseRetiredCatalog', index.slice(start, end));
async function checkout(body) {
  let status = 200;
  let result;
  await handler(
    { body, user: { username: 'tester', userId: 'u1' } },
    { status(code) { status = code; return this; }, json(value) { result = value; return this; } },
    () => 'https://app.example.test', getPlan,
    { checkout: { sessions: { async create(params) { sessions.push(params); return { id: 'cs_test', url: 'https://checkout.example.test' }; } } } },
    buildPlanCheckoutSessionParams,
    { async updateOne(...args) { events.push(args); } }, refuseRetiredCatalog,
  );
  return { status, result };
}
let response = await checkout({ planName: 'Standard', totalAmount: 1 });
assert.equal(response.status, 200);
assert.equal(sessions.length, 1);
assert.equal(sessions[0].line_items[0].price_data.unit_amount, getPlan('Standard').priceCents);
assert.equal(sessions[0].metadata.purchaseType, 'plan_tokens');
assert.equal(events.length, 1);
for (const body of [
  { cartItems: [{ source: 'catalog', catalogId: 'BAS1' }] },
  { description: 'molecule', totalAmount: 1 },
  { planName: 'unknown', cartItems: [] },
]) {
  response = await checkout(body);
  assert.equal(response.status, 503);
  assert.equal(response.result.code, 'CATALOG_RETIRED');
}
assert.equal(sessions.length, 1);
assert.equal(events.length, 1);

// Demo compute must reject supplier URLs before RCSB/conversion/provider fetch.
// Preserve the native fetch solely for requests to this local test listener.
const originalFetch = globalThis.fetch;
let outboundCalls = 0;
globalThis.fetch = async () => { outboundCalls += 1; throw new Error('Unexpected outbound request'); };
const previous = { dock: process.env.ASINEX_DOCKING_API_URL, diff: process.env.DIFFDOCK_API_URL };
process.env.ASINEX_DOCKING_API_URL = 'https://services.asinex.com:8000/docking';
process.env.DIFFDOCK_API_URL = 'https://SERVICES.ASINEX.COM.:58000/diffdock';
const app = express();
app.use(express.json());
app.use(createStagingDemoRouter({ jwtSecret: 'fixture-secret' }));
const server = await new Promise((resolve) => { const listener = app.listen(0, '127.0.0.1', () => resolve(listener)); });
try {
  const token = jwt.sign({ username: 'fixture-user' }, 'fixture-secret');
  for (const [route, body] of [
    ['/api/simulation', { pdbid: '1abc', smiles: 'CCO' }],
    ['/api/diffdock/generate', { protein: '1abc', ligand: 'CCO' }],
  ]) {
    const res = await originalFetch(`http://127.0.0.1:${server.address().port}${route}`, {
      method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    });
    assert.equal(res.status, 503);
    assert.equal((await res.json()).code, 'SUPPLIER_PROVIDER_RETIRED');
  }
  assert.equal(outboundCalls, 0);
} finally {
  await new Promise((resolve) => server.close(resolve));
  globalThis.fetch = originalFetch;
  if (previous.dock === undefined) delete process.env.ASINEX_DOCKING_API_URL; else process.env.ASINEX_DOCKING_API_URL = previous.dock;
  if (previous.diff === undefined) delete process.env.DIFFDOCK_API_URL; else process.env.DIFFDOCK_API_URL = previous.diff;
}
console.log('Catalog independence: host boundaries, real plan/cart handler, demo zero-outbound compute passed');
