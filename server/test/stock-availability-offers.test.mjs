import { stockResultFromItem } from '../../client/src/utils/stockResults.js';
// Opt-in weekly stock availability snapshot, application side: stock offer
// minting on every search path, revalidation of new quotes/checkouts, and the
// stored-Stripe-retry guarantees. Fixtures only: no network, Mongo or Stripe.
// Scientific-host side: services/owned-search/stock-availability-test.mjs.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import http from 'node:http';
import express from 'express';
import { createCompoundShopRouter } from '../routes/compoundShop.js';
import { createOwnedSearch } from '../utils/ownedSearch.js';
import { mintCompoundOffer } from '../utils/compoundShopOffers.js';
import { withCompoundShopOffers, withCompoundShopOffersChecked } from '../utils/compoundShopSearch.js';
import {
  StockAvailabilityError, assertStockOffersAvailable, createStockAvailability, normalizeStockCode,
} from '../utils/stockAvailability.js';

const secret = 'stock-availability-fixture-secret-long-enough';
const now = 1790200000000;
let checks = 0;
const tests = [];
const test = (name, fn) => tests.push([name, fn]);
const ok = (condition, label) => { assert.ok(condition, label); checks += 1; };

/** A stand-in for createStockAvailability(): `snapshot` is a Map, null (inactive) or an Error (service down). */
function fakeStock(snapshot) {
  const calls = [];
  return {
    calls,
    set(next) { snapshot = next; },
    async lookup(codes) {
      calls.push([...codes]);
      if (snapshot instanceof Error) throw snapshot;
      if (snapshot === null) return { active: false };
      return { active: true, asOf: '2026-11-02', mg: (code) => { const key = normalizeStockCode(code); return key !== null && snapshot.has(key) ? snapshot.get(key) : null; } };
    },
  };
}
const stockRow = (id, code, importedMg, extra = {}) => ({ molecule_id: id, canonical_smiles: 'CCO', similarity: 0.9, metadata: { MAIN_BAS: code, CURRENT_TOT_NETTO_MG: String(importedMg) }, ...extra });
const macroRow = (source, id, code) => ({ source, molecule_id: id, canonical_smiles: 'CCN', metadata: { MAIN_BAS: code, web_mg: '5' } });
const packMgs = (row) => row.shopOffer.packs.map((pack) => pack.mg);

test('client: opt-in, three states, fail closed on anything else', async () => {
  assert.equal(createStockAvailability({ baseUrl: '' }), null, 'unset env keeps today\'s behavior');
  assert.equal(createStockAvailability({}), null);
  const answer = (status, body) => async () => ({ ok: status < 300, status, json: async () => body });
  const lookup = (fetchImpl) => createStockAvailability({ baseUrl: 'http://127.0.0.1:1/stock-availability/', fetchImpl }).lookup(['BAS 00000001']);
  assert.deepEqual(await lookup(answer(200, { state: 'inactive' })), { active: false });
  const active = await lookup(answer(200, { state: 'active', asOf: '2026-11-02', items: { 'BAS 00000001': 12.5, '__proto__': 3 } }));
  ok(active.active && active.mg('bas  00000001') === 12.5 && active.mg('BAS 00000002') === null && active.mg('x') === null, 'present, missing and unusable codes');
  const seen = [];
  await createStockAvailability({ baseUrl: 'http://h/stock-availability', fetchImpl: async (url, init) => { seen.push([url, JSON.parse(init.body)]); return { ok: true, status: 200, json: async () => ({ state: 'inactive' }) }; } })
    .lookup([' bas  00000001', 'BAS 00000001', 'junk', 7]);
  assert.deepEqual(seen, [['http://h/stock-availability/lookup', { codes: ['BAS 00000001'] }]], 'codes are normalized, de-duplicated and junk is never sent');
  const failures = {
    'service 503': answer(503, { state: 'failed' }),
    'html error page': async () => ({ ok: true, status: 200, json: async () => { throw new SyntaxError('x'); } }),
    'network down': async () => { throw new TypeError('fetch failed'); },
    'unknown state': answer(200, { state: 'loading' }),
    'items missing': answer(200, { state: 'active' }),
    'items array': answer(200, { state: 'active', items: [] }),
    'negative amount': answer(200, { state: 'active', items: { 'BAS 00000001': -1 } }),
    'string amount': answer(200, { state: 'active', items: { 'BAS 00000001': '5' } }),
  };
  for (const [name, fetchImpl] of Object.entries(failures)) {
    await assert.rejects(lookup(fetchImpl), (error) => error instanceof StockAvailabilityError && error.status === 503 && error.code === 'STOCK_AVAILABILITY_UNAVAILABLE', name);
  }
  checks += Object.keys(failures).length;
});

test('offers: snapshot amounts are authoritative for stock rows, in both directions', async () => {
  const payload = { results: [
    stockRow(1, 'BAS 00000001', 10), // snapshot lower
    stockRow(2, 'BAS 00000002', 2),  // snapshot higher
    stockRow(3, 'BAS 00000003', 50), // missing from snapshot
    stockRow(4, 'BAS 00000004', 50), // zero
    stockRow(5, 'BAS 00000005', 50), // 0.5 mg: under the 1 mg offer minimum
    stockRow(6, 'LAS 00000006', 1),  // exactly 1 mg
  ] };
  const stock = fakeStock(new Map([['BAS 00000001', 3], ['BAS 00000002', 30], ['BAS 00000004', 0], ['BAS 00000005', 0.5], ['LAS 00000006', 1]]));
  const out = await withCompoundShopOffersChecked(payload, 'stock', { secret, now, stockAvailability: stock });
  const [lower, higher, missing, zero, tiny, one] = out.results;
  assert.deepEqual(out.results.map(row => stockResultFromItem(row).STOCK_MG), [3, 30, null, 0, 0.5, 1]);
  ok(lower.shopOffer.availableMg === 3 && Math.max(...packMgs(lower)) <= 3, 'snapshot lowers an imported amount');
  ok(higher.shopOffer.availableMg === 30 && packMgs(higher).includes(20) && !packMgs(higher).includes(50), 'snapshot raises an imported amount');
  ok(missing.shopOffer === null, 'missing from the active snapshot: no offer');
  ok(zero.shopOffer === null && tiny.shopOffer === null, 'zero and sub-minimum amounts: no offer');
  ok(one.shopOffer?.availableMg === 1, '1 mg is sellable');
  ok(stock.calls.length === 1 && stock.calls[0].length === 6, 'one lookup per payload');
  ok(out.results.every((row, index) => row.molecule_id === payload.results[index].molecule_id && row.canonical_smiles === 'CCO'), 'search rows are otherwise untouched');
});

test('offers: inactive and unconfigured keep imported amounts exactly; a failed lookup mints no stock offers', async () => {
  const payload = { results: [stockRow(1, 'BAS 00000001', 10), stockRow(2, 'BAS 00000002', 0.4)] };
  const baseline = withCompoundShopOffers(payload, 'stock', { secret, now });
  assert.deepEqual(await withCompoundShopOffersChecked(payload, 'stock', { secret, now }), baseline);
  assert.deepEqual(await withCompoundShopOffersChecked(payload, 'stock', { secret, now, stockAvailability: fakeStock(null) }), baseline);
  assert.deepEqual(baseline.results.map((row) => row.shopOffer?.availableMg ?? null), [10, null]);
  const down = fakeStock(new StockAvailabilityError('STOCK_AVAILABILITY_UNAVAILABLE', 'down'));
  const failed = await withCompoundShopOffersChecked(payload, 'stock', { secret, now, stockAvailability: down });
  ok(failed.results.every((row) => row.shopOffer === null) && failed.results.length === 2, 'fail closed: results stay, offers do not');
  ok(payload.results.every((row) => !('shopOffer' in row)), 'input is not mutated');
});

test('offers: only stock rows consult the snapshot (multi, both, macrocycle searches)', async () => {
  const stock = fakeStock(new Map([['BAS 00000001', 4]]));
  const mixed = { results: [macroRow('real', 1, 'RPX 202406561'), stockRow(7, 'BAS 00000001', 99, { source: 'stock' }), macroRow('virtual', 2, 'VPX 900000003')] };
  const multi = await withCompoundShopOffersChecked(mixed, 'multi', { secret, now, stockAvailability: stock });
  ok(multi.results[1].shopOffer.availableMg === 4, 'stock row in a multi search uses the snapshot');
  ok(multi.results[0].shopOffer.source === 'real' && multi.results[0].shopOffer.availableMg === 5 && multi.results[2].shopOffer.source === 'virtual', 'RPX/VPX rows are unchanged');
  ok(stock.calls.length === 1 && stock.calls[0].join() === 'BAS 00000001', 'only stock codes are looked up');
  stock.calls.length = 0;
  const both = await withCompoundShopOffersChecked({ results: [macroRow('real', 1, 'RPX 202406561'), macroRow('virtual', 2, 'VPX 900000003')] }, 'both', { secret, now, stockAvailability: stock });
  ok(stock.calls.length === 0 && both.results.every((row) => row.shopOffer), 'RPX + VPX searches never call the stock lookup');
  ok((await withCompoundShopOffersChecked({ found: 0 }, 'stock', { secret, stockAvailability: stock })).found === 0, 'payloads without results pass through');
});

test('every owned-search path mints stock offers from the snapshot', async () => {
  const stockPage = [stockRow(7, 'BAS 00123456', 10)];
  const provider = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost'); res.setHeader('Content-Type', 'application/json');
    let body = ''; for await (const chunk of req) body += chunk;
    if (url.pathname === '/v1/search/similarity') {
      const dataset = url.searchParams.get('dataset_ids') || url.searchParams.get('dataset_id');
      return res.end(JSON.stringify({ results: dataset === '4' ? stockPage : [macroRow('real', 1, 'RPX 202406561')] }));
    }
    if (url.pathname === '/search') return res.end(JSON.stringify({ results: JSON.parse(body).source === 'stock' ? stockPage : [macroRow('real', 1, 'RPX 202406561')], truncated: false }));
    res.statusCode = 404; res.end('{}');
  });
  await new Promise((resolve) => provider.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${provider.address().port}`;
  const datasets = { real: { source: 'real', id: 1, name: 'real', rowCount: 6, metrics: ['tanimoto'] }, virtual: { source: 'virtual', id: 2, name: 'virtual', rowCount: 6, metrics: ['tanimoto'] } };
  const stock = fakeStock(new Map([['BAS 00123456', 3]]));
  const owned = createOwnedSearch({ graphBase: base, fetchImpl: fetch, stockConfig: { baseUrl: base }, stockResolver: { resolve: async () => ({ id: 4, name: 'Stock' }) },
    macroConfig: { baseUrl: base }, macroResolver: { resolve: async (source) => datasets[source] }, openConfig: { enabled: false }, secret, stockAvailability: stock });
  try {
    const offerOf = (data, source) => data.results.find((row) => row.source === source)?.shopOffer;
    for (const body of [
      { source: 'stock', mode: 'similarity', queries: ['CCO'], threshold: 0.5, limit: 10 },
      { source: 'stock', mode: 'id', queries: ['BAS 00123456'], limit: 10 },
      { source: 'multi', sources: ['stock', 'real'], mode: 'similarity', queries: ['CCO'], threshold: 0.5, limit: 10 },
      { source: 'multi', sources: ['stock', 'real'], mode: 'substructure', queries: ['CC'], limit: 10 },
    ]) {
      stock.calls.length = 0;
      const data = await owned.run(body);
      ok(offerOf(data, 'stock')?.availableMg === 3, `${body.source}/${body.mode}: snapshot amount (imported was 10)`);
      if (body.source === 'multi') ok(offerOf(data, 'real')?.availableMg === 5 && stock.calls.every((codes) => codes.join() === 'BAS 00123456'), 'multi: macrocycle rows untouched, only stock codes looked up');
    }
    stock.set(new Map());
    ok(offerOf(await owned.run({ source: 'stock', mode: 'similarity', queries: ['CCO'], threshold: 0.5, limit: 10 }), 'stock') === null, 'missing from snapshot: row listed, no offer');
    stock.set(new StockAvailabilityError('STOCK_AVAILABILITY_UNAVAILABLE', 'down'));
    const down = await owned.run({ source: 'stock', mode: 'id', queries: ['BAS 00123456'], limit: 10 });
    ok(down.results.length === 1 && down.results[0].shopOffer === null, 'lookup outage: search still works, no stock offer');
    stock.set(null);
    ok(offerOf(await owned.run({ source: 'stock', mode: 'id', queries: ['BAS 00123456'], limit: 10 }), 'stock').availableMg === 10, 'inactive: imported amount');
  } finally { provider.close(); }
});

test('assertStockOffersAvailable is a pure gate over stock lines', async () => {
  const line = (code, rowId, amountMg, quantity) => ({ source: 'stock', code, rowId: String(rowId), amountMg, quantity });
  const rejects = (items, stock, code, status) => assert.rejects(assertStockOffersAvailable(items, stock), (error) => error.code === code && error.status === status);
  await assertStockOffersAvailable([line('BAS 00000001', 1, 5, 1)], null);
  const stock = fakeStock(new Map([['BAS 00000001', 10], ['BAS 00000002', 0]]));
  await assertStockOffersAvailable([{ source: 'real', code: 'RPX 1', rowId: '1', amountMg: 5, quantity: 1 }], stock);
  ok(stock.calls.length === 0, 'carts without stock lines make no lookup');
  await assertStockOffersAvailable([line('BAS 00000001', 1, 5, 2)], stock);
  await rejects([line('BAS 00000001', 1, 5, 2), line('BAS 00000001', 1, 1, 1)], stock, 'COMPOUND_STOCK_LIMIT', 409);
  await rejects([line('BAS 00000002', 2, 1, 1)], stock, 'COMPOUND_STOCK_UNAVAILABLE', 409);
  await rejects([line('BAS 00000003', 3, 1, 1)], stock, 'COMPOUND_STOCK_UNAVAILABLE', 409);
  await rejects([line('BAS 00000001', 1, 1, 1)], fakeStock(new Error('boom')), 'STOCK_AVAILABILITY_UNAVAILABLE', 503);
  await assertStockOffersAvailable([line('BAS 00000003', 3, 1, 1)], fakeStock(null));
  checks += 5;
});

// ── Router: real quote engine and price book, Stripe and order store in memory. ──
function routerHarness(stockAvailability) {
  const records = new Map();
  const matches = (row, filter) => Object.entries(filter).every(([key, value]) => {
    if (key === '$or') return value.some((entry) => matches(row, entry));
    if (value && typeof value === 'object' && '$ne' in value) return row[key] !== value.$ne;
    return value === null ? row[key] == null : row[key] === value;
  });
  const orders = {
    async findOne(filter) { return structuredClone([...records.values()].find((row) => matches(row, filter)) || null); },
    async insertOne(row) { if (records.has(row._id)) throw Object.assign(new Error('duplicate'), { code: 11000 }); records.set(row._id, structuredClone(row)); },
    async updateOne(filter, update) { const row = [...records.values()].find((entry) => matches(entry, filter)); if (!row) return { matchedCount: 0 }; Object.assign(row, structuredClone(update.$set)); return { matchedCount: 1 }; },
  };
  const state = { createCalls: 0, retrieveCalls: 0, loseResponse: false };
  const sessions = new Map(); const creations = new Map();
  const stripe = { checkout: { sessions: {
    async create(params, options) {
      state.createCalls += 1;
      const previous = creations.get(options.idempotencyKey);
      if (previous) { assert.deepEqual(params, previous.params, 'a retry must send byte-identical Stripe parameters'); return structuredClone(previous.session); }
      const id = `cs_test_${String(creations.size + 1).padStart(16, '0')}`;
      const session = { id, url: `https://checkout.stripe.com/c/pay/${id}`, mode: params.mode, status: 'open', payment_status: 'unpaid', currency: params.line_items[0].price_data.currency,
        amount_total: params.line_items.reduce((sum, item) => sum + item.price_data.unit_amount * item.quantity, 0), metadata: params.metadata, client_reference_id: params.client_reference_id };
      creations.set(options.idempotencyKey, { params: structuredClone(params), session: structuredClone(session) });
      sessions.set(id, session);
      if (state.loseResponse) { state.loseResponse = false; throw new Error('response lost'); }
      return structuredClone(session);
    },
    async retrieve(id) { state.retrieveCalls += 1; return structuredClone(sessions.get(id)); },
  } } };
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { req.user = { username: 'alice', companyId: 'one', userId: 'alice' }; next(); });
  app.use('/shop', createCompoundShopRouter({ stripe, getOrders: () => orders, getAppUrl: () => 'https://app.example', secret, stockAvailability }));
  const server = app.listen(0, '127.0.0.1');
  return {
    state, records, close: () => server.close(),
    async ready() { await new Promise((resolve) => server.once('listening', resolve)); return this; },
    async call(path, body) {
      const response = await fetch(`http://127.0.0.1:${server.address().port}/shop${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
      return { status: response.status, body: await response.json() };
    },
  };
}
const stockOffer = (code, rowId, importedMg) => mintCompoundOffer({ source: 'stock', rowId, code, smiles: 'CCO', availableMg: importedMg }, { secret });
const cart = (offer, amountMg, quantity) => [{ offerToken: offer.token, amountMg, quantity }];

test('quote and checkout revalidate stock on new quotes', async () => {
  const stock = fakeStock(new Map([['BAS 00000001', 10]]));
  const shop = await routerHarness(stock).ready();
  try {
    const offer = stockOffer('BAS 00000001', 41, 10);
    const quote = (items) => shop.call('/quote', { items });
    ok((await quote(cart(offer, 5, 2))).status === 200, 'enough stock: quoted');
    stock.set(new Map([['BAS 00000001', 9]]));
    const over = await quote(cart(offer, 5, 2));
    ok(over.status === 409 && over.body.code === 'COMPOUND_STOCK_LIMIT', 'the snapshot dropped below the cart: refused with 409 (never 401)');
    stock.set(new Map());
    const gone = await quote(cart(offer, 1, 1));
    ok(gone.status === 409 && gone.body.code === 'COMPOUND_STOCK_UNAVAILABLE', 'compound missing from the active snapshot: refused');
    stock.set(new Map([['BAS 00000001', 0]]));
    ok((await quote(cart(offer, 1, 1))).body.code === 'COMPOUND_STOCK_UNAVAILABLE', 'zero: refused');
    stock.set(new Error('down'));
    const outage = await quote(cart(offer, 1, 1));
    ok(outage.status === 503 && outage.body.code === 'STOCK_AVAILABILITY_UNAVAILABLE', 'lookup outage: retryable 503, never the imported amount');
    stock.set(null);
    ok((await quote(cart(offer, 5, 2))).status === 200, 'inactive: imported behavior');
    const calls = stock.calls.length;
    const macro = mintCompoundOffer({ source: 'real', rowId: 3, code: 'RPX 202406561', smiles: 'CCN', availableMg: 5 }, { secret });
    ok((await quote(cart(macro, 1, 1))).status === 200 && stock.calls.length === calls, 'macrocycle carts never consult the snapshot');
    // A new checkout is refused before any order or Stripe session exists.
    stock.set(new Map());
    const checkout = await shop.call('/checkout', { items: cart(offer, 1, 1), expectedTotalCents: 1, priceBookVersion: 'x', idempotencyKey: randomUUID() });
    ok(checkout.status === 409 && checkout.body.code === 'COMPOUND_STOCK_UNAVAILABLE' && shop.records.size === 0 && shop.state.createCalls === 0, 'new checkout for gone stock: no order, no Stripe session');
  } finally { shop.close(); }
});

test('stored Stripe retries are untouched by stock revalidation', async () => {
  const stock = fakeStock(new Map([['BAS 00000001', 10]]));
  const shop = await routerHarness(stock).ready();
  try {
    const offer = stockOffer('BAS 00000001', 41, 10);
    const items = cart(offer, 2, 1);
    const quoted = (await shop.call('/quote', { items })).body;
    const body = (key) => ({ items, currency: 'usd', expectedTotalCents: quoted.totalCents, priceBookVersion: quoted.priceBookVersion, idempotencyKey: key });

    // 1. An order with a stored session: retries reconcile with Stripe and never look at stock.
    const first = randomUUID();
    const created = await shop.call('/checkout', body(first));
    ok(created.status === 200 && shop.state.createCalls === 1, 'new checkout with stock available creates the session');
    stock.set(new Map()); stock.calls.length = 0;
    const replay = await shop.call('/checkout', body(first));
    ok(replay.status === 200 && replay.body.url === created.body.url && stock.calls.length === 0 && shop.state.createCalls === 1, 'stored-session retry returns the same URL with zero lookups, even though stock is now gone');
    stock.set(new Error('down'));
    ok((await shop.call('/checkout', body(first))).status === 200, 'stored-session retry also survives a lookup outage');

    // 2. Order persisted but the Stripe response was lost: the retry is revalidated yet stays identical.
    stock.set(new Map([['BAS 00000001', 10]]));
    const second = randomUUID();
    shop.state.loseResponse = true;
    ok((await shop.call('/checkout', body(second))).status === 503, 'lost Stripe response leaves an order without a session');
    const orderId = [...shop.records.keys()].find((id) => id !== created.body.orderId);
    const fingerprint = shop.records.get(orderId).fingerprint;
    const paramsBefore = JSON.stringify(shop.records.get(orderId).checkoutParams);
    stock.set(new Map([['BAS 00000001', 2]])); stock.calls.length = 0;
    const retried = await shop.call('/checkout', body(second));
    ok(retried.status === 200 && retried.body.orderId === orderId && stock.calls.length === 1, 'retry without a session is revalidated and still completes when stock suffices');
    ok(shop.records.get(orderId).fingerprint === fingerprint && JSON.stringify(shop.records.get(orderId).checkoutParams) === paramsBefore, 'a changed snapshot amount changes neither the order fingerprint nor the stored Stripe parameters');
    ok(shop.state.createCalls === 3, 'Stripe saw the identical request again (idempotent replay)');

    // 3. Same lost-response case, but the compound has since left the snapshot: refuse, create nothing.
    const third = randomUUID();
    stock.set(new Map([['BAS 00000001', 10]]));
    shop.state.loseResponse = true;
    await shop.call('/checkout', body(third));
    const createsBefore = shop.state.createCalls;
    stock.set(new Map());
    const refused = await shop.call('/checkout', body(third));
    ok(refused.status === 409 && refused.body.code === 'COMPOUND_STOCK_UNAVAILABLE' && shop.state.createCalls === createsBefore, 'no session yet and stock gone: refused before Stripe');
  } finally { shop.close(); }
});

let failed = 0;
for (const [name, fn] of tests) {
  try { await fn(); console.log(`  PASS ${name}`); }
  catch (error) { failed += 1; console.error(`  FAIL ${name}: ${error.stack || error.message}`); }
}
console.log(`Stock availability offers: ${tests.length - failed}/${tests.length} groups passed, ${checks} extra assertions`);
if (failed) process.exit(1);
