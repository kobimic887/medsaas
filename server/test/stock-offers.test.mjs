// Unit tests for stock pack-offer normalisation + cart pricing helpers.
// Fixture: REAL /api4/bas response captured 2026-09-12 (see fixtures/).
//
// Run: SERVER_RUNTIME=bun bun test/stock-offers.test.mjs

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import {
  MAX_STOCK_OFFER_CODES,
  compoundRowFromOffer,
  normalizeStockOffer,
  normalizeStockOfferCode,
  packsFromOfferRow,
  parseStockOfferCodes,
  priceMoleculeCartFromOffers,
  resolveStockOffers,
  StockOffersUpstreamError,
  StockOffersValidationError,
} from '../utils/stockOffers.js';
import { priceMoleculeCart } from '../utils/asinexCompound.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixture = JSON.parse(
  readFileSync(path.join(__dirname, 'fixtures/api4-bas-stock-codes.json'), 'utf8'),
);

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

function checkThrows(label, fn, Expected) {
  try {
    fn();
    check(label, false, '(did not throw)');
  } catch (error) {
    const ok = Expected ? error instanceof Expected : true;
    check(label, ok, `(${error.name}: ${error.message})`);
  }
}

console.log('Stock offers normalisation + resolve:\n');

check('fixture has five live rows', fixture.found === 5 && fixture.results.length === 5);
const first = normalizeStockOffer(fixture.results[0]);
check('bas_code preserved with leading zeros space', first.code === 'BAS 30906909');
check('offerId is catalog row id', first.offerId === 134);
check('packs are 1/2/5/10 with live USD', JSON.stringify(first.packs) === JSON.stringify([
  { amountMg: 1, priceUSD: 170 },
  { amountMg: 2, priceUSD: 194 },
  { amountMg: 5, priceUSD: 218 },
  { amountMg: 10, priceUSD: 242 },
]));
check('packsFromOfferRow skips non-positive', packsFromOfferRow({ price_1mg: 0, price_5mg: 10 }).length === 1);

check('normalizeStockOfferCode collapses whitespace', normalizeStockOfferCode('  ASN   33727025 ') === 'ASN 33727025');
check('normalizeStockOfferCode rejects N/A', normalizeStockOfferCode('N/A') === '');

checkThrows('empty codes rejected', () => parseStockOfferCodes({ codes: [] }), StockOffersValidationError);
checkThrows('missing codes rejected', () => parseStockOfferCodes({}), StockOffersValidationError);
check('dedupes codes preserving order', JSON.stringify(parseStockOfferCodes({
  codes: ['ASN 33727025', 'BAS 30906909', 'ASN 33727025'],
})) === JSON.stringify(['ASN 33727025', 'BAS 30906909']));
check('bas string form accepted', JSON.stringify(parseStockOfferCodes({
  bas: 'ASN 33727025, BAS 30906909',
})) === JSON.stringify(['ASN 33727025', 'BAS 30906909']));
check('max codes bound documented', MAX_STOCK_OFFER_CODES === 50);
checkThrows(
  'oversize batch rejected',
  () => parseStockOfferCodes({ codes: Array.from({ length: 51 }, (_, i) => `ASN ${String(i).padStart(8, '0')}`) }),
  StockOffersValidationError,
);

const compound = compoundRowFromOffer(first);
check('compound row exposes bas_code for checkout', compound.bas_code === 'BAS 30906909' && compound.price_5mg === 218);
check(
  'priceMoleculeCart uses offer compound row',
  priceMoleculeCart([{ catalogId: 'BAS 30906909', amount: 5 }], [compound]).totalCents === 21800,
);

// --- resolveStockOffers with injected fetch ---
const calls = [];
const stubFetch = async (url, opts) => {
  calls.push({ url, body: JSON.parse(opts.body) });
  return {
    ok: true,
    status: 200,
    text: async () => JSON.stringify(fixture.results),
  };
};

const resolved = await resolveStockOffers(
  ['ASN 33727025', 'UNKNOWN 00000001', 'BAS 30906909'],
  { catalogApiBase: 'http://catalog.test', fetchImpl: stubFetch },
);
check('upstream called /api4/bas', calls[0].url === 'http://catalog.test/api4/bas');
check('upstream bas list joins codes', calls[0].body.bas === 'ASN 33727025,UNKNOWN 00000001,BAS 30906909');
check('resolved offers keep request order for hits', resolved.offers.map((o) => o.code).join(',') === 'ASN 33727025,BAS 30906909');
check('unresolved codes listed', JSON.stringify(resolved.unresolvedCodes) === JSON.stringify(['UNKNOWN 00000001']));
check('ASN 33727025 packs match fixture', resolved.offers[0].packs[0].priceUSD === 170);

const failFetch = async () => ({ ok: false, status: 503, text: async () => '{"error":"down"}' });
try {
  await resolveStockOffers(['ASN 1'], { catalogApiBase: 'http://catalog.test', fetchImpl: failFetch });
  check('upstream non-ok throws', false);
} catch (error) {
  check('upstream non-ok throws StockOffersUpstreamError', error instanceof StockOffersUpstreamError);
}

const priced = await priceMoleculeCartFromOffers(
  [
    { catalogId: 'ASN 33727025', amount: 1, totalPrice: 0.01, name: 'forged' },
    { catalogId: 'BAS 30906909', amount: 10, price: 1 },
  ],
  { catalogApiBase: 'http://catalog.test', fetchImpl: stubFetch },
);
check('checkout discards forged client totals', priced.totalCents === 17000 + 24200);
check('checkout line names use stock codes', priced.lineItems[0].price_data.product_data.name === 'ASN 33727025 · 1 mg');

try {
  await priceMoleculeCartFromOffers(
    [{ catalogId: 'MISSING CODE', amount: 1 }],
    {
      catalogApiBase: 'http://catalog.test',
      fetchImpl: async () => ({ ok: true, status: 200, text: async () => '[]' }),
    },
  );
  check('unknown code at checkout rejected', false);
} catch (error) {
  check('unknown code at checkout rejected', /no longer in the catalog/i.test(error.message));
}

console.log(`\nstock-offers: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
