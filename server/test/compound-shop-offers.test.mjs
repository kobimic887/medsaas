import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { PRICE_BOOK_VERSION, workbookPacksForRow, approximateUsd } from '../../shared/compoundPriceBook.js';
import { mintCompoundOffer, quoteCompoundCart, CompoundShopError } from '../utils/compoundShopOffers.js';

let passed = 0;
let failed = 0;
function check(label, run) {
  try { run(); passed++; console.log(`  PASS ${label}`); }
  catch (error) { failed++; console.error(`  FAIL ${label}: ${error.message}`); }
}
const options = { secret: 'fixture-owned-shop-offer-secret-not-production', now: 1790200000000 };
const stock = { source: 'stock', rowId: 41, code: 'LAS123', smiles: 'CCO', availableMg: '20.5', leadTime: '14 days' };
const real = { ...stock, source: 'real', rowId: 3, code: 'RPX123', availableMg: 10 };
const virtual = { ...stock, source: 'virtual', rowId: 3, code: 'VPX123', availableMg: null, leadTime: '56 days' };
const offer = (input = stock) => mintCompoundOffer(input, options);
const line = (input = stock, amountMg = 1, quantity = 1) => ({ offerToken: offer(input).token, amountMg, quantity });
function rejects(items, code, overrides = {}) {
  assert.throws(() => quoteCompoundCart(items, { ...options, ...overrides }), error => error instanceof CompoundShopError && error.code === code);
}
// Encode deliberately malformed payloads with the test secret to exercise version/
// purpose validation independently of the cryptographic tamper check.
function resign(payload) {
  const encoded = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const key = createHmac('sha256', options.secret).update('pyxis-owned-compound-offer-v1').digest();
  return `${encoded}.${createHmac('sha256', key).update(encoded).digest('base64url')}`;
}

console.log('Owned workbook pricing and signed compound offers:');
check('all approved list values, source cells and EUR/USD cents match', () => {
  // Stock: December 2025 Asinex USD list, 1–10 compounds (EUR = USD / 1.1367).
  const stock = [
    ['BAS123', 'C', [132, 158, 184, 211, 277, 330, 422, 587], [11613, 13900, 16187, 18563, 24369, 29031, 37125, 51641]],
    ['LAS123', 'D', [194, 224, 254, 284, 375, 466, 568, 786], [17067, 19706, 22345, 24985, 32990, 40996, 49969, 69148]],
    ['PRO123', 'E', [251, 291, 330, 370, 487, 606, 739, 1022], [22081, 25600, 29031, 32550, 42843, 53312, 65013, 89909]],
  ];
  for (const [code, column, dollars, eurCents] of stock) {
    const { packs, listCurrency } = workbookPacksForRow('stock', code);
    assert.equal(listCurrency, 'usd');
    assert.deepEqual(packs.map(p => p.unitAmountCents), dollars.map((usd) => usd * 100));
    assert.deepEqual(packs.map(p => p.eurCents), eurCents);
    assert.deepEqual(packs.map(p => p.sourceCell), dollars.map((_, index) => `ASINEX Price List USD!${column}${13 - index}`));
    assert.deepEqual(packs.map(p => p.mg), [1, 2, 5, 10, 20, 30, 50, 100]);
  }
  // Macrocycles and virtual: Pyxis EUR workbook (USD = EUR × 1.1367).
  const fixtures = [
    ['real', 'RPX123', 'E', [317, 365, 420], [36033, 41490, 47741]],
    ['virtual', 'VPX123', 'F', [400, 460, 529], [45468, 52288, 60131]],
    ['smallvirtual', '123-456', 'F', [400, 460, 529], [45468, 52288, 60131]],
  ];
  for (const [source, code, column, euros, cents] of fixtures) {
    const { packs } = workbookPacksForRow(source, code);
    assert.deepEqual(packs.map(p => p.eur), euros);
    assert.deepEqual(packs.map(p => p.eurCents), euros.map((eur) => eur * 100));
    assert.deepEqual(packs.map(p => p.unitAmountCents), cents);
    assert.deepEqual(packs.map(p => p.sourceCell), euros.map((_, index) => `Sheet1!${column}${12 - index}`));
    assert.deepEqual(packs.map(p => p.mg), [1, 2, 5]);
  }
  assert.equal(approximateUsd(317), '$360.33');
  assert.equal(approximateUsd(350), '$397.85');
});
check('spaced, compact and lower-case prefixes use the same category', () => {
  assert.deepEqual(workbookPacksForRow('stock', 'las 123'), workbookPacksForRow('stock', 'LAS123'));
  assert.deepEqual(workbookPacksForRow('real', 'rpx 123'), workbookPacksForRow('real', 'RPX123'));
  assert.deepEqual(workbookPacksForRow('virtual', 'vpx 123'), workbookPacksForRow('virtual', 'VPX123'));
});
check('unsupported sources, invalid codes and cross-source prefixes cannot mint offers', () => {
  for (const input of [{ ...stock, source: 'chembl' }, { ...stock, source: 'catalog' }, { ...stock, code: 'RPX123' }, { ...real, code: 'VPX123' }, { ...virtual, code: 'BAS123' }, { ...stock, code: 'LAS' }]) assert.equal(offer(input), null);
});
check('positive decimal availability is strict, required for stock and real, and filters packs', () => {
  for (const availableMg of [null, undefined, '', 0, -1, NaN, Infinity, '2 mg', 'Infinity', '1e2', ' 20 ', true, '20junk', '1,000', '1.0000000000000001']) {
    assert.equal(offer({ ...stock, availableMg }), null);
    assert.equal(offer({ ...real, availableMg }), null);
  }
  assert.deepEqual(offer({ ...stock, availableMg: '2.5' }).packs.map(p => p.mg), [1, 2]);
  assert.equal(offer({ ...stock, availableMg: '0.5' }), null);
  assert.equal(offer(virtual).availableMg, null);
});
check('float32 stock quantities preserve their full precision and enforce the aggregate cap', () => {
  for (const availableMg of [8.3999996, '8.3999996']) {
    const input = { ...stock, availableMg };
    assert.deepEqual(offer(input).packs.map(p => p.mg), [1, 2, 5]);
    assert.equal(offer(input).availableMg, 8.3999996);
    const quote = quoteCompoundCart([line(input, 5), line(input, 2), line(input, 1)], options);
    assert.equal(quote.items.reduce((sum, item) => sum + item.amountMg * item.quantity, 0), 8);
    rejects([line(input, 5), line(input, 2, 2)], 'COMPOUND_STOCK_LIMIT');
  }
  for (const availableMg of [2138.3999, 355.29999]) {
    assert.equal(offer({ ...stock, availableMg }).availableMg, availableMg);
  }
});
check('server identity, workbook price and integer cents override untrusted cart fields', () => {
  const quote = quoteCompoundCart([{ ...line(real, 2, 3), code: 'FREE', price: 0.01, unitAmountCents: 1, smiles: 'C' }], options);
  assert.equal(quote.items[0].code, 'RPX123');
  assert.equal(quote.items[0].smiles, 'CCO');
  assert.equal(quote.items[0].unitAmountCents, 41490);
  assert.equal(quote.items[0].lineTotalCents, 124470);
  assert.equal(quote.items[0].availableMg, 10);
  assert.equal(quote.items[0].leadTime, '14 days');
  assert.equal(quote.totalCents, 124470);
  assert.equal(quote.priceBookVersion, PRICE_BOOK_VERSION);
  assert.equal(quote.currency, 'usd');
});
check('EUR quotes combine exact euro list values and converted stock prices in cents', () => {
  const quote = quoteCompoundCart([line(real, 2, 3), line(stock, 1, 2)], { ...options, currency: 'eur' });
  assert.equal(quote.currency, 'eur');
  assert.deepEqual(quote.items.map((item) => [item.eurCents, item.unitAmountCents, item.lineTotalCents, item.currency]), [[36500, 36500, 109500, 'eur'], [17067, 17067, 34134, 'eur']]);
  assert.equal(quote.totalCents, 143634);
  rejects([line(real, 2)], 'INVALID_COMPOUND_CURRENCY', { currency: 'gbp' });
});
check('signed identity, quantity, price-book version and purpose cannot be tampered with', () => {
  const item = line();
  const [encoded, sig] = item.offerToken.split('.');
  const payload = JSON.parse(Buffer.from(encoded, 'base64url').toString());
  const edited = Buffer.from(JSON.stringify({ ...payload, availableMg: 9999 })).toString('base64url');
  rejects([{ ...item, offerToken: `${edited}.${sig}` }], 'INVALID_COMPOUND_OFFER');
  for (const alteration of [{ purpose: 'jwt' }, { priceBookVersion: 'old' }, { source: 'chembl' }, { issuedAt: options.now + 1 }, { expiresAt: options.now + 100000000 }]) {
    rejects([{ ...item, offerToken: resign({ ...payload, ...alteration }) }], 'INVALID_COMPOUND_OFFER');
  }
  rejects([item], 'INVALID_COMPOUND_OFFER', { secret: 'another-secure-test-secret' });
});
check('offer expires at 24 hours with actionable 409 and remains valid just before', () => {
  const items = [line()];
  assert.ok(quoteCompoundCart(items, { ...options, now: options.now + 86400000 - 1 }));
  assert.throws(() => quoteCompoundCart(items, { ...options, now: options.now + 86400000 }), error => error.code === 'SHOP_OFFER_EXPIRED' && error.status === 409);
});
check('quantity and packs accept bounded JSON integers only', () => {
  for (const quantity of [0, -1, 11, 1.5, '1', true, NaN, Infinity]) rejects([line(virtual, 1, quantity)], 'INVALID_COMPOUND_QUANTITY');
  for (const amountMg of [0, -1, 3, 10, '1', true, 1.5]) rejects([line(virtual, amountMg)], 'INVALID_COMPOUND_PACK');
  assert.equal(quoteCompoundCart([line(virtual, 5, 10)], options).totalCents, 601310);
});
check('duplicate pack lines are rejected instead of bypassing quantity limits', () => {
  rejects([line(real), line(real)], 'DUPLICATE_COMPOUND_PACK');
});
check('aggregated packs cannot exceed the known inventory snapshot', () => {
  rejects([line(real, 5, 2), line(real, 1)], 'COMPOUND_STOCK_LIMIT');
  assert.equal(quoteCompoundCart([line(real, 5, 2)], options).totalCents, 95482);
  rejects([line({ ...real, availableMg: 5 }, 5), line({ ...real, availableMg: 20 }, 2)], 'COMPOUND_STOCK_LIMIT');
});
check('the tier counts source plus row ID, preserving duplicate codes and cross-source IDs', () => {
  const items = [line(real), line(virtual), line({ ...real, rowId: 4 })];
  assert.equal(quoteCompoundCart(items, options).items.length, 3);
  rejects([...items, line({ ...real, rowId: 5 })], 'COMPOUND_TIER_LIMIT');
});
check('combined rounded unit prices sum in cents without total-level conversion drift', () => {
  const items = [line({ ...stock, availableMg: 500 }, 30, 3), line(real, 1, 2), line(virtual, 2, 3)];
  assert.equal(quoteCompoundCart(items, options).totalCents, 46600 * 3 + 36033 * 2 + 52288 * 3);
  assert.equal(quoteCompoundCart(items, { ...options, currency: 'eur' }).totalCents, 40996 * 3 + 31700 * 2 + 46000 * 3);
});
check('tokens, row metadata and cart size are bounded', () => {
  for (const offerToken of ['', 'x'.repeat(24001), 'a.b', null]) rejects([{ offerToken, amountMg: 1, quantity: 1 }], 'INVALID_COMPOUND_OFFER');
  for (const input of [{ ...stock, rowId: {} }, { ...stock, rowId: '' }, { ...stock, rowId: 'a'.repeat(129) }, { ...stock, smiles: '' }, { ...stock, smiles: 'C'.repeat(12001) }]) assert.equal(offer(input), null);
  rejects([], 'INVALID_COMPOUND_CART');
  rejects(Array.from({ length: 25 }, () => line()), 'INVALID_COMPOUND_CART');
  assert.throws(() => mintCompoundOffer(stock, { secret: '', now: options.now }), /configured secret/);
});

console.log(`\n${passed} passed; ${failed} failed.`);
if (failed) process.exit(1);
