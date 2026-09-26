import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import express from 'express';
import { createCompoundShopRouter } from '../routes/compoundShop.js';
import { handleCompoundShopSession } from '../utils/compoundShopOrders.js';
import { PRICE_BOOK_VERSION } from '../../shared/compoundPriceBook.js';

const records = new Map();
function matches(row, filter) {
  return Object.entries(filter).every(([key, value]) => {
    if (key === '$or') return value.some((entry) => matches(row, entry));
    if (value && typeof value === 'object' && '$ne' in value) return row[key] !== value.$ne;
    return value === null ? row[key] == null : row[key] === value;
  });
}
const orders = {
  async findOne(filter) { return structuredClone([...records.values()].find((row) => matches(row, filter)) || null); },
  async insertOne(row) {
    if (records.has(row._id)) throw Object.assign(new Error('duplicate'), { code: 11000 });
    records.set(row._id, structuredClone(row));
    return { insertedId: row._id };
  },
  async updateOne(filter, update) {
    const row = [...records.values()].find((entry) => matches(entry, filter));
    if (!row) return { matchedCount: 0 };
    Object.assign(row, structuredClone(update.$set));
    return { matchedCount: 1 };
  },
  find(filter) {
    return {
      sort() { return this; }, limit() { return this; },
      async toArray() { return structuredClone([...records.values()].filter((row) => matches(row, filter))); },
    };
  },
};
const sessions = new Map();
const creations = new Map();
let createCalls = 0;
let retrieveCalls = 0;
let failAfterCreate = false;
let failNextRetrieve = false;
const stripe = { checkout: { sessions: {
  async create(params, options) {
    createCalls++;
    const previous = creations.get(options.idempotencyKey);
    if (previous) { assert.deepEqual(params, previous.params); return structuredClone(previous.session); }
    const id = `cs_test_${String(creations.size + 1).padStart(16, '0')}`;
    const session = {
      id, url: `https://checkout.stripe.com/c/pay/${id}`, mode: params.mode,
      status: 'open', payment_status: 'unpaid', currency: 'usd',
      amount_total: params.line_items.reduce((sum, item) => sum + item.price_data.unit_amount * item.quantity, 0),
      metadata: params.metadata, client_reference_id: params.client_reference_id,
    };
    creations.set(options.idempotencyKey, { params: structuredClone(params), session: structuredClone(session) });
    sessions.set(id, session);
    if (failAfterCreate) { failAfterCreate = false; throw new Error('response lost'); }
    return structuredClone(session);
  },
  async retrieve(id) { retrieveCalls++; if (failNextRetrieve) { failNextRetrieve = false; throw new Error('Stripe unavailable'); } return structuredClone(sessions.get(id)); },
} } };
let offersExpired = false;
const quoteCart = async (items) => {
  if (offersExpired) throw Object.assign(new Error('Offer expired'), { status: 400, code: 'COMPOUND_OFFER_EXPIRED' });
  if (!Array.isArray(items) || !items.length) throw Object.assign(new Error('Invalid items'), { status: 400, code: 'SHOP_INVALID_REQUEST' });
  const canonical = items.map((item) => ({
    key: `real:${item.offerToken}`, source: 'real', rowId: item.offerToken,
    code: 'RPX123', smiles: 'CCO', amountMg: item.amountMg, quantity: item.quantity,
    eur: 317, unitAmountCents: 36033, lineTotalCents: 36033 * item.quantity,
    offerToken: item.offerToken, availableMg: 50, leadTime: '14 days',
  }));
  return { items: canonical, totalCents: canonical.reduce((sum, item) => sum + item.lineTotalCents, 0), currency: 'usd', priceBookVersion: PRICE_BOOK_VERSION, fx: { rate: 1.1367 } };
};
const app = express();
app.use(express.json());
app.use((req, _res, next) => {
  req.user = { username: req.get('x-user') || 'alice', companyId: req.get('x-company') || 'one', userId: req.get('x-user') || 'alice' };
  next();
});
app.use('/api/compound-shop', createCompoundShopRouter({ stripe, getOrders: () => orders, getAppUrl: () => 'https://app.example/staging', secret: 'test', quoteCart }));
const server = app.listen(0, '127.0.0.1');
await new Promise((resolve) => server.once('listening', resolve));
const base = `http://127.0.0.1:${server.address().port}/api/compound-shop`;
let assertions = 0;
function ok(condition, message) { assert.ok(condition, message); assertions++; }
async function request(path, body, headers = {}) {
  const result = await fetch(`${base}${path}`, { method: body ? 'POST' : 'GET', headers: { 'content-type': 'application/json', ...headers }, ...(body ? { body: JSON.stringify(body) } : {}) });
  return { status: result.status, body: await result.json() };
}
const basket = (extra = {}) => ({ items: [{ offerToken: 'signed-row-1', amountMg: 1, quantity: 1 }], expectedTotalCents: 36033, priceBookVersion: PRICE_BOOK_VERSION, idempotencyKey: randomUUID(), ...extra });
try {
  const config = await request('/config');
  ok(config.body.paymentMode === 'automatic' && config.body.shippingNote.includes('included'), 'config defines immediate payment and shipping inclusion');
  const quoted = await request('/quote', { items: basket().items });
  ok(quoted.body.totalCents === 36033 && quoted.body.items[0].code === 'RPX123', 'quote returns canonical server prices');
  const changed = await request('/checkout', basket({ expectedTotalCents: 1 }));
  ok(changed.status === 409 && changed.body.code === 'SHOP_PRICES_CHANGED' && createCalls === 0, 'tampered total requires explicit re-review without Stripe');
  const version = await request('/checkout', basket({ priceBookVersion: 'old' }));
  ok(version.status === 409 && createCalls === 0, 'stale price book requires review');
  const missingKey = await request('/checkout', basket({ idempotencyKey: 'bad' }));
  ok(missingKey.status === 400 && createCalls === 0, 'checkout requires UUID retry key');
  const firstBody = basket({ amount: 1, username: 'mallory', currency: 'eur' });
  const [first, concurrent] = await Promise.all([request('/checkout', firstBody), request('/checkout', firstBody)]);
  ok(first.status === 200 && concurrent.status === 200 && first.body.orderId === concurrent.body.orderId, 'concurrent retries share an order');
  ok(creations.size === 1 && records.size === 1, 'concurrent retries create one Stripe payment');
  const saved = records.get(first.body.orderId);
  ok(saved.username === 'alice' && saved.currency === 'usd' && saved.totalCents === 36033, 'server identity and USD price override body');
  ok(!JSON.stringify(saved).includes('offerToken'), 'signed offer tokens are not persisted');
  const params = creations.get(saved._id).params;
  ok(params.payment_intent_data.capture_method === 'automatic' && params.payment_method_types[0] === 'card', 'card captured automatically');
  ok(!params.shipping_options && params.shipping_address_collection.allowed_countries.includes('IL') && params.shipping_address_collection.allowed_countries.includes('GB'), 'included shipping collects international addresses without an added fee');
  ok(params.billing_address_collection === 'required' && params.success_url.includes('/staging/dashboard/compound-orders'), 'billing and staged return path preserved');
  ok(!JSON.stringify(params.metadata).includes('signed-row') && !JSON.stringify(params.metadata).includes('CCO'), 'payment metadata contains no molecule token or structure');
  const replay = await request('/checkout', firstBody);
  ok(replay.body.sessionId === first.body.sessionId && creations.size === 1, 'replay reuses saved session');
  const openReprice = await request('/checkout', { ...firstBody, expectedTotalCents: 1 });
  ok(openReprice.status === 409 && openReprice.body.code === 'SHOP_PRICES_CHANGED' && openReprice.body.quote.totalCents === 36033, 'open saved checkout still requires acceptance of its exact price');
  failNextRetrieve = true;
  const callsBeforeUncertain = createCalls;
  const uncertainRetry = await request('/checkout', firstBody);
  ok(uncertainRetry.status === 503 && createCalls === callsBeforeUncertain, 'uncertain Stripe lookup preserves attempt without creating another checkout');
  const reused = await request('/checkout', { ...firstBody, items: [{ ...firstBody.items[0], quantity: 2 }], expectedTotalCents: 72066 });
  ok(reused.status === 409 && reused.body.code === 'SHOP_CHECKOUT_KEY_REUSED', 'same key cannot buy a different cart');
  const otherUser = await request(`/orders/${saved._id}`, undefined, { 'x-user': 'bob' });
  const otherCompany = await request(`/orders/${saved._id}`, undefined, { 'x-company': 'two' });
  ok(otherUser.status === 404 && otherCompany.status === 404, 'order ownership covers user and company');
  const otherList = await request('/orders', undefined, { 'x-company': 'two' });
  ok(otherList.body.orders.length === 0, 'other company cannot list orders');
  const ownList = await request('/orders');
  ok(ownList.body.orders.length === 1 && !JSON.stringify(ownList.body).includes('checkoutParams') && !JSON.stringify(ownList.body).includes('fingerprint'), 'history uses safe projection');
  const retrievalsBeforeSpoof = retrieveCalls;
  const spoof = await request(`/orders/${saved._id}?session_id=cs_test_wrong0000000000000`);
  ok(spoof.status === 409 && retrieveCalls === retrievalsBeforeSpoof, 'wrong URL session refused before Stripe lookup');
  const session = sessions.get(first.body.sessionId);
  session.status = 'complete'; session.payment_status = 'paid';
  session.shipping_details = { name: 'Alice', address: { country: 'IL', city: 'Tel Aviv', line1: '1 Main St' } };
  session.customer_details = { name: 'Alice', email: 'alice@example.test', phone: '+123', address: { country: 'IL' } };
  const invalid = { ...session, amount_total: 1 };
  await assert.rejects(handleCompoundShopSession(invalid, { orders }), /does not match/);
  ok(records.get(saved._id).status === 'awaiting_payment', 'wrong payment amount cannot fulfill');
  await assert.rejects(handleCompoundShopSession({ ...session, metadata: { ...session.metadata, companyId: 'two' } }, { orders }), /does not match/);
  await assert.rejects(handleCompoundShopSession({ ...session, currency: 'eur' }, { orders }), /does not match/);
  const completed = await request(`/orders/${saved._id}?session_id=${session.id}`);
  ok(completed.body.order.status === 'paid' && completed.body.order.shipping.address.country === 'IL', 'Stripe-verified return reconciles payment and shipping');
  const paidAt = records.get(saved._id).paidAt.toISOString();
  offersExpired = true;
  const callsBeforePaidRetry = createCalls;
  const paidRetry = await request('/checkout', firstBody);
  ok(paidRetry.status === 409 && paidRetry.body.code === 'SHOP_ORDER_ALREADY_PAID' && paidRetry.body.orderId === saved._id && createCalls === callsBeforePaidRetry, 'paid checkout with expired offers routes to the existing order without new payment');
  offersExpired = false;
  await handleCompoundShopSession(session, { orders, eventType: 'checkout.session.completed' });
  ok(records.get(saved._id).paidAt.toISOString() === paidAt, 'duplicate paid event preserves paid timestamp');
  await handleCompoundShopSession({ ...session, status: 'expired', payment_status: 'unpaid' }, { orders, eventType: 'checkout.session.expired' });
  ok(records.get(saved._id).status === 'paid', 'late expiration cannot regress paid state');
  ok(await handleCompoundShopSession({ metadata: { purchaseType: 'plan_tokens' } }, { orders }) === false, 'credit plan event remains outside compound fulfillment');
  const lostBody = basket(); failAfterCreate = true;
  const lost = await request('/checkout', lostBody);
  ok(lost.status === 503, 'lost Stripe response returns retryable unavailable');
  const retry = await request('/checkout', lostBody);
  ok(retry.status === 200 && creations.size === 2, 'retry after lost response recovers the same payment');
  const secondSession = sessions.get(retry.body.sessionId);
  secondSession.status = 'complete';
  const callsBeforePendingRetry = createCalls;
  const pendingRetry = await request('/checkout', lostBody);
  ok(pendingRetry.status === 409 && pendingRetry.body.code === 'SHOP_PAYMENT_PENDING' && createCalls === callsBeforePendingRetry, 'complete unpaid checkout sends customer to order status without a new charge');
  secondSession.status = 'expired';
  offersExpired = true;
  const expiredRetry = await request('/checkout', lostBody);
  ok(expiredRetry.status === 409 && expiredRetry.body.code === 'SHOP_CHECKOUT_EXPIRED' && !expiredRetry.body.url && createCalls === callsBeforePendingRetry, 'expired checkout recovers despite expired offers and permits a fresh reviewed attempt');
  offersExpired = false;
  await handleCompoundShopSession(secondSession, { orders, eventType: 'checkout.session.expired' });
  ok(records.get(retry.body.orderId).status === 'expired', 'expired unpaid session is recorded');
  secondSession.status = 'complete'; secondSession.payment_status = 'paid';
  secondSession.collected_information = { shipping_details: { name: 'New API', address: { country: 'GB' } } };
  await handleCompoundShopSession(secondSession, { orders, eventType: 'checkout.session.async_payment_succeeded' });
  ok(records.get(retry.body.orderId).status === 'paid' && records.get(retry.body.orderId).shipping.address.country === 'GB', 'verified payment wins with new Stripe shipping fields');
  const thirdBody = basket(); failAfterCreate = true;
  await request('/checkout', thirdBody);
  const pending = [...records.values()].find((row) => !row.sessionId);
  pending.createdAt = new Date(Date.now() - 21 * 60 * 60 * 1000);
  const beforeOldRetry = createCalls;
  const tooOld = await request('/checkout', thirdBody);
  ok(tooOld.status === 409 && tooOld.body.code === 'SHOP_CHECKOUT_RECOVERY_REQUIRED' && createCalls === beforeOldRetry, 'old ambiguous payment does not create a second charge after idempotency expiry');
  const pendingSession = creations.get(pending._id).session;
  await handleCompoundShopSession({ ...pendingSession, status: 'complete', payment_status: 'no_payment_required' }, { orders });
  ok(records.get(pending._id).status === 'awaiting_payment', 'free-payment state cannot fulfill a positive-price order');
  await handleCompoundShopSession(pendingSession, { orders, eventType: 'checkout.session.async_payment_failed' });
  ok(records.get(pending._id).status === 'payment_failed', 'payment failure recorded without treating completion as paid');
  const malformedId = await request('/orders/not-an-order');
  ok(malformedId.status === 400, 'malformed order IDs cannot reach database lookup');
  console.log(`compound shop orders: ${assertions} checks passed`);
} finally { await new Promise((resolve) => server.close(resolve)); }
