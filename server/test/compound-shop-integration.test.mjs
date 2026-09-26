// Real application auth/search/quote/webhook boundary with ephemeral Mongo and
// an owned-search fixture. No Stripe API calls, production data, or payments.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { MongoClient } from 'mongodb';
import jwt from 'jsonwebtoken';
import Stripe from 'stripe';
import { compoundOrderId } from '../utils/compoundShopOrders.js';
import { withCompoundShopOffers } from '../utils/compoundShopSearch.js';

const secret = 'compound_shop_fixture_secret_32_chars';
const webhookSecret = 'whsec_compound_shop_integration_fixture';
const port = 35100 + process.pid % 1000;
const base = `http://127.0.0.1:${port}`;
const user = { username: 'shop-buyer', userId: 'buyer-id', companyId: 'shop-company', role: 'member' };
const peer = { ...user, username: 'shop-peer', userId: 'peer-id' };
const dbName = 'compound_shop_integration';
let child; let mongo; let memory; let fixture; let serverLog = '';
let checks = 0;
function check(condition, label) { assert.ok(condition, label); checks++; console.log(`  ✓ ${label}`); }
async function request(route, body, claims = user) {
  const headers = { 'Content-Type': 'application/json' };
  if (claims) headers.Authorization = `Bearer ${jwt.sign(claims, secret, { expiresIn: '10m' })}`;
  const res = await fetch(base + route, { method: body === undefined ? 'GET' : 'POST', headers, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: res.status, body: await res.json() };
}
async function webhook(session, signingSecret = webhookSecret) {
  const stripe = new Stripe('sk_test_signatures_only');
  const payload = JSON.stringify({ id: 'evt_fixture_compound', type: 'checkout.session.completed', data: { object: session } });
  const signature = await stripe.webhooks.generateTestHeaderStringAsync({ payload, secret: signingSecret });
  return fetch(base + '/stripe/webhook', { method: 'POST', headers: { 'Content-Type': 'application/json', 'Stripe-Signature': signature }, body: payload });
}
try {
  fixture = http.createServer((_req, res) => {
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ found: true, results: [{ molecule_id: 123, canonical_smiles: 'CCO', similarity: 1, metadata: { MAIN_BAS: 'LAS123', CURRENT_TOT_NETTO_MG: 8.3999996 } }] }));
  });
  await new Promise(resolve => fixture.listen(0, '127.0.0.1', resolve));
  memory = await MongoMemoryServer.create();
  mongo = new MongoClient(memory.getUri(dbName));
  await mongo.connect();
  const db = mongo.db(dbName);
  await db.collection('users').insertMany([user, peer].map(u => ({ ...u, active: true, verified: true, email: `${u.username}@example.test`, simulationTokens: 17 })));
  await db.collection('companies').insertOne({ companyId: user.companyId, active: true, name: 'Shop fixture' });
  const runtime = process.env.SERVER_RUNTIME || 'bun';
  child = spawn(runtime === 'bun' ? (process.env.BUN_PATH || `${process.env.HOME}/.bun/bin/bun`) : process.execPath, ['index.js'], {
    cwd: fileURLToPath(new URL('..', import.meta.url)),
    env: { ...process.env, PORT: String(port), BIND_HOST: '127.0.0.1', MONGODB_URI: memory.getUri(dbName), JWT_SECRET: secret,
      NODE_ENV: 'test', PYXIS_DEMO_MODE: 'false', PYXIS_STAGING_MODE: 'false', STRIPE_SECRET_KEY: 'sk_test_no_network_calls', STRIPE_WEBHOOK_SECRET: webhookSecret,
      STOCK_SEARCH_BASE: `http://127.0.0.1:${fixture.address().port}`, STOCK_SEARCH_DATASET_ID: '41', FRONTEND_DIST: '', BASE_URL: base, FRONTEND_URL: base },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout.on('data', d => { serverLog += d; }); child.stderr.on('data', d => { serverLog += d; });
  let ready = false;
  for (let i = 0; i < 120; i++) { try { ready = (await fetch(base + '/health')).ok; } catch {} if (ready) break; await new Promise(resolve => setTimeout(resolve, 200)); }
  check(ready, 'real application started');
  check((await request('/api/compound-shop/config', undefined, null)).status === 401, 'shop requires authentication');
  const config = await request('/api/compound-shop/config');
  check(config.status === 200 && config.body.paymentMode === 'automatic' && config.body.shippingNote.includes('included'), 'shop advertises approved immediate-charge and shipping policy');
  const searched = await request('/api/stock-search/similarity?smiles=CCO&threshold=1&limit=1');
  const offer = searched.body.results?.[0]?.shopOffer;
  check(searched.status === 200 && offer?.token && offer.code === 'LAS123', 'real search mints an offer from the owned row');
  check(offer.packs.length === 3 && offer.packs[0].unitAmountCents === 25689, 'search offers approved LAS prices bounded by snapshot mg');
  const items = [{ offerToken: offer.token, amountMg: 1, quantity: 2, price: 0.01 }];
  const quoted = await request('/api/compound-shop/quote', { items });
  check(quoted.status === 200 && quoted.body.totalCents === 51378, 'server quotes exact workbook cents, ignoring forged client prices');
  check((await request('/api/compound-shop/quote', { items: [{ ...items[0], offerToken: offer.token + 'x' }] })).status === 400, 'tampered offer rejected before checkout');
  check((await request('/api/compound-shop/quote', { items: [{ source: 'open', code: 'CHEMBL25', amountMg: 1, quantity: 1 }] })).status === 400, 'ChEMBL and unsigned invented rows cannot be bought');
  const mismatch = await request('/api/compound-shop/checkout', { items, expectedTotalCents: 1, priceBookVersion: quoted.body.priceBookVersion, idempotencyKey: '12345678-1234-4123-8123-123456789012' });
  check(mismatch.status === 409 && mismatch.body.code === 'SHOP_PRICES_CHANGED', 'price review blocks payment creation when total differs');
  check(await db.collection('compound_orders').countDocuments() === 0, 'rejected checkout creates no order');
  const macros = withCompoundShopOffers({ results: [
    { source: 'real', molecule_id: 7, canonical_smiles: 'CCO', metadata: { MAIN_BAS: 'RPX7', web_mg: '5.0', Lead_TIME: '28 days' } },
    { source: 'virtual', molecule_id: 7, canonical_smiles: 'CCO', metadata: { MAIN_BAS: 'VPX7', web_mg: '5', Lead_TIME: '28 days' } },
  ] }, 'both', { secret });
  check(macros.results[0].shopOffer.source === 'real' && macros.results[1].shopOffer.source === 'virtual', 'combined search retains per-row offer provenance');
  const orderId = compoundOrderId({ username: user.username, companyId: user.companyId }, 'fixture-order');
  const sessionId = 'cs_test_compoundfixture123456';
  const order = { _id: orderId, username: user.username, userId: user.userId, companyId: user.companyId, sessionId, status: 'awaiting_payment', fulfillmentStatus: 'pending', ...quoted.body, createdAt: new Date(), updatedAt: new Date() };
  await db.collection('compound_orders').insertOne(order);
  check((await request(`/api/compound-shop/orders/${orderId}`, undefined, peer)).status === 404, 'other users cannot inspect an order');
  check((await request('/api/compound-shop/orders', undefined, peer)).body.orders.length === 0, 'order history does not leak peer orders');
  const session = { id: sessionId, mode: 'payment', status: 'complete', payment_status: 'paid', amount_total: quoted.body.totalCents, currency: 'usd', client_reference_id: orderId,
    metadata: { purchaseType: 'pyxis_compounds', orderId, username: user.username, companyId: user.companyId, userId: user.userId },
    customer_details: { email: 'buyer@example.test', name: 'Test buyer' }, collected_information: { shipping_details: { name: 'Test buyer', address: { line1: '1 Example Road', city: 'Example', country: 'NL', postal_code: '1234AB' } } } };
  check((await webhook(session, 'wrong-secret')).status === 400, 'forged Stripe webhook cannot mark an order paid');
  check((await db.collection('compound_orders').findOne({ _id: orderId })).status === 'awaiting_payment', 'forged event leaves pending order unchanged');
  check((await webhook(session)).status === 200, 'verified paid webhook accepted');
  check((await webhook(session)).status === 200, 'paid webhook replay remains successful');
  check((await webhook({ ...session, payment_status: 'unpaid' })).status === 200, 'delayed unpaid event is handled');
  const stored = await db.collection('compound_orders').findOne({ _id: orderId });
  check(stored.status === 'paid' && stored.shipping.address.country === 'NL', 'paid order stays paid and stores delivery details');
  check((await db.collection('users').findOne({ username: user.username })).simulationTokens === 17, 'compound purchases never grant simulation credits');
  const history = await request('/api/compound-shop/orders');
  check(history.body.orders[0].status === 'paid' && !history.body.orders[0].items[0].offerToken, 'own order history reports payment without exposing signed offers');
  console.log(`Compound shop integration: ${checks} checks passed`);
} catch (error) {
  console.error(serverLog.slice(-2500)); throw error;
} finally {
  if (child) { child.kill('SIGTERM'); await new Promise(resolve => { if (child.exitCode !== null) resolve(); else child.once('exit', resolve); }); }
  await mongo?.close(); await memory?.stop();
  if (fixture) await new Promise(resolve => fixture.close(resolve));
}
