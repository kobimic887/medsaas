import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel) => readFileSync(path.join(root, rel), 'utf8');

const catalogPricing = read('server/utils/catalogPricing.js');
const indexJs = read('server/index.js');
const stagingDemo = read('server/routes/stagingDemo.js');
const dashboardNavbar = read('client/src/widgets/layout/dashboard-navbar.jsx');
const moleculeCartUtil = read('client/src/utils/moleculeCart.js');
const clientUtilPath = path.join(root, 'client/src/utils/stockOffers.js');
const clientUtil = existsSync(clientUtilPath) ? readFileSync(clientUtilPath, 'utf8') : '';

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

// Owner decision 2026-09-13: internal-catalog purchases re-price from the
// ORIGINAL catalog API's per-compound prices (GET /api/id/<code>); stock
// compounds are not purchasable; POST /api4/bas is banned for pricing. This
// gate owns the server pricing path and the navbar's basket handling — the
// Simulation display side lives in scripts/check-stock-offers-lifecycle.mjs.
console.log('Catalog checkout pricing lifecycle (server re-pricing + basket refusal):\n');

// ── the /api4/bas pricing path is really gone ────────────────────────────────
check('server/utils/stockOffers.js is deleted', !existsSync(path.join(root, 'server/utils/stockOffers.js')));
// Comment lines may document the ban; executable code must never call it.
const catalogPricingCode = catalogPricing
  .split('\n')
  .filter((line) => !/^\s*(\/\/|\*|\/\*)/.test(line))
  .join('\n');
check('server pricing module never calls /api4/bas', !catalogPricingCode.includes('api4/bas'));
check('index.js has no leftover stock-offers pricing imports', !indexJs.includes('priceMoleculeCartFromOffers') && !indexJs.includes('resolveStockOffers') && !indexJs.includes('parseStockOfferCodes'));

// ── checkout re-prices from the original catalog API ─────────────────────────
check('checkout calls priceMoleculeCartFromCatalog', indexJs.includes('priceMoleculeCartFromCatalog'));
check('pricing module resolves rows via GET /api/id', catalogPricing.includes('/api/id/'));
check('codes are URL-encoded with prefix + space intact', catalogPricing.includes('encodeURIComponent(code)'));

// ── 409 review + Stripe ordering (unchanged contract) ────────────────────────
check('checkout blocks stale basket with 409 MOLECULE_PRICES_CHANGED', indexJs.includes('moleculeCartPriceReview') && indexJs.includes('MOLECULE_PRICES_CHANGED'));
const reviewIdx = indexJs.indexOf("code: 'MOLECULE_PRICES_CHANGED'");
const moleculeStripeIdx = reviewIdx > -1 ? indexJs.indexOf('stripe.checkout.sessions.create', reviewIdx) : -1;
check('409 review precedes the molecule Stripe session call', reviewIdx > -1 && moleculeStripeIdx > -1);

// ── stock-origin refusal ─────────────────────────────────────────────────────
check('checkout maps stock-origin rows to 400 MOLECULE_STOCK_ITEMS_UNSUPPORTED', indexJs.includes("code: 'MOLECULE_STOCK_ITEMS_UNSUPPORTED'") && indexJs.includes('MoleculeCartStockItemsError'));
check('rejection carries the offending rows', catalogPricing.includes('unsupportedItems'));
check('legacy source-less rows are catalog, only stockCode/stock markers refuse', catalogPricing.includes("item.source === 'stock'") && catalogPricing.includes('stockCode'));

// ── /api/stock-offers is an explicit refusal ─────────────────────────────────
check("POST /api/stock-offers route registered as a refusal", indexJs.includes("code: 'STOCK_OFFERS_DISABLED'"));
check('staging still refuses /api/stock-offers earlier', stagingDemo.includes('"/api/stock-offers"'));

// ── upstream /api4/bas has zero runtime callers (pricing AND search) ─────────
check('api4/bas route kept for BAS search (same client contract)', indexJs.includes("app.post('/api/api4/bas'"));
check('api4/bas route serves from the catalog wrapper, not upstream', indexJs.includes('searchCatalogRowsByBasCodes'));
// The route PATH legitimately contains '/api/api4/bas'; what must never come
// back is the old upstream URL construction.
const indexCode = indexJs
  .split('\n')
  .filter((line) => !/^\s*(\/\/|\*|\/\*)/.test(line))
  .join('\n');
check(
  'no executable server code targets upstream /api4/bas',
  !indexCode.includes('`${catalogApiBase}/api4/bas`') && !indexCode.includes("'api4/bas'") && !indexCode.includes('"api4/bas"'),
);

// ── navbar basket handling ───────────────────────────────────────────────────
check('navbar keys the review branch on 409 + MOLECULE_PRICES_CHANGED', dashboardNavbar.includes("response.status === 409 && errorData.code === 'MOLECULE_PRICES_CHANGED'"));
check('navbar adopts re-priced rows via the moleculeCart util', dashboardNavbar.includes('cartItemsFromPriceReview') && dashboardNavbar.includes('persistMoleculeCart') && moleculeCartUtil.includes('updatedCartItems'));
check('navbar handles MOLECULE_STOCK_ITEMS_UNSUPPORTED by removing the rows', dashboardNavbar.includes("errorData.code === 'MOLECULE_STOCK_ITEMS_UNSUPPORTED'") && dashboardNavbar.includes('unsupportedItems') && dashboardNavbar.includes('cartTotalFromItems'));

// ── client cart helper markers (when the parallel display slice keeps them) ──
if (clientUtil) {
  check('catalog cart rows keep the source: catalog marker', clientUtil.includes("source: 'catalog'"));
}

// ── live execution: the navbar stock-rejection branch ────────────────────────
// Runs the real handler source with the same extraction the Simulation
// pricing lifecycle uses, feeding a MOLECULE_STOCK_ITEMS_UNSUPPORTED reply.
const handlerSource = dashboardNavbar.split('  const handleCheckout = async () => {')[1].split('\n  const logout =')[0].trim().replace(/};$/, '');
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
const basket = [
  { source: 'stock', catalogId: 'ASN 33727025', amount: 1, totalPrice: 170, name: 'ASN 33727025' },
  { source: 'catalog', catalogId: 'BAS 00293357', amount: 5, totalPrice: 66, name: 'C10 H6' },
];
const windowStub = { location: { href: '' }, clearTimeout() {}, setTimeout() { return 1; }, dispatchEvent() {} };
const persisted = { items: null, total: null };
const shownMessages = [];
const runCheckout = new AsyncFunction(
  'cartItems', 'window', 'cartRequestControllerRef', 'cartTimeoutRef', 'CART_FETCH_TIMEOUT_MS',
  'setCartAction', 'getAuthToken', 'API_CONFIG', 'fetch', 'showActionMessage',
  'persistMoleculeCart', 'cartItemsFromPriceReview', 'cartTotalFromItems', 'loadCartFromStorage',
  handlerSource,
);
await runCheckout(
  basket, windowStub, { current: null }, { current: null }, 30000,
  () => {}, () => 'fixture-token', { buildUrl: (p) => p },
  async () => ({
    ok: false,
    status: 400,
    json: async () => ({
      code: 'MOLECULE_STOCK_ITEMS_UNSUPPORTED',
      error: 'Stock compounds are no longer purchasable. Remove them from your basket to continue.',
      unsupportedItems: [{ index: 0, catalogId: 'ASN 33727025', name: 'ASN 33727025' }],
    }),
  }),
  (message) => shownMessages.push(message),
  (_storage, items, total) => { persisted.items = items; persisted.total = total; return true; },
  () => null,
  (items) => items.reduce((sum, item) => sum + (item?.totalPrice || 0), 0),
  () => {},
);
check('stock rejection removes only the stock-origin rows', persisted.items?.length === 1 && persisted.items[0].catalogId === 'BAS 00293357', JSON.stringify(persisted.items));
check('stock rejection recomputes the surviving total', persisted.total === 66);
check('stock rejection shows a clear removal message', shownMessages.some((m) => /no longer purchasable/i.test(m) && /removed/.test(m)), JSON.stringify(shownMessages));
check('stock rejection never redirects to Stripe', windowStub.location.href === '');

console.log(`\ncatalog-pricing lifecycle: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
