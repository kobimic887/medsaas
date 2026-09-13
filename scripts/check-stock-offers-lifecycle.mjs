import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const simulation = readFileSync(
  path.join(root, 'client/src/pages/dashboard/simulation.jsx'),
  'utf8',
);
const stockOffersUtil = readFileSync(
  path.join(root, 'client/src/utils/stockOffers.js'),
  'utf8',
);
const stagingDemo = readFileSync(
  path.join(root, 'server/routes/stagingDemo.js'),
  'utf8',
);
const dashboardNavbar = readFileSync(
  path.join(root, 'client/src/widgets/layout/dashboard-navbar.jsx'),
  'utf8',
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

// Owner decision 2026-09-13: the Internal catalog displays and baskets the
// original catalog API's per-compound pack prices from its own browse/search
// responses; stock compounds carry no prices; the browser never prices via
// POST /api/stock-offers (or /api4/bas). Checkout review stays server-owned.
console.log('Simulation pricing lifecycle (catalog pack prices, stock unpriced):\n');

check('simulation imports the catalog price cart helper', simulation.includes("cartItemFromCatalogPrice } from '@/utils/stockOffers'"));
check('no automatic offer lookups remain on the page', !simulation.includes('/stock-offers'));
check('offer state map is gone', !simulation.includes('stockOffersByCode') && !simulation.includes('stockOffersRequestRef'));
check('catalog price cell / retry banner machinery is gone', !simulation.includes('catalogPriceCell') && !simulation.includes('Retry live prices') && !simulation.includes('Quote required'));
check('stock table has no Purchase column', !simulation.includes('>Purchase</'));
check('stock banner states rows are not priced or purchasable', simulation.includes('not priced or purchasable here'));
check('catalog normalizer maps the catalog pack prices (both spellings)', simulation.includes('PRICE_1MG: molecule.PRICE_1MG ?? molecule.price_1mg') && simulation.includes('PRICE_5MG: molecule.PRICE_5MG ?? molecule.price_5mg') && simulation.includes('PRICE_10MG: molecule.PRICE_10MG ?? molecule.price_10mg'));
check('catalog price headers are the plain pack columns', simulation.includes('>Price 1mg</') && simulation.includes('>Price 5mg</') && simulation.includes('>Price 10mg</'));
check('catalog cells basket the displayed pack prices', simulation.includes('addToCart(mol, 1, mol.PRICE_1MG)') && simulation.includes('addToCart(mol, 5, mol.PRICE_5MG)') && simulation.includes('addToCart(mol, 10, mol.PRICE_10MG)'));
check('unpriced cells are disabled, not dropped', simulation.includes('disabled={!mol.PRICE_1MG}'));
check('addToCart prices every add through cartItemFromCatalogPrice', simulation.includes('const cartItem = cartItemFromCatalogPrice(molecule, amount, price);'));
check('helper has no offer/quote lookup path', !stockOffersUtil.includes('fetch('));
check('BAS-first checkout identity chain kept in the shared helper', stockOffersUtil.includes('molecule.BAS_CODE || molecule.bas_code || molecule.basCode') && stockOffersUtil.includes('|| molecule.ASINEX_ID || molecule.id_number || molecule.id'));
check('staging still refuses /api/stock-offers', stagingDemo.includes('"/api/stock-offers"'));

const {
  cartItemFromCatalogPrice,
  catalogOfferCode,
  CATALOG_PACK_WEIGHTS_MG,
} = await import(pathToFileURL(path.join(root, 'client/src/utils/stockOffers.js')).href);

check('pack weights stay the supplier set 1/2/5/10', CATALOG_PACK_WEIGHTS_MG.length === 4 && CATALOG_PACK_WEIGHTS_MG.join(',') === '1,2,5,10');

// ── Internal catalog priced from its own browse/search responses ────────────
// Measured live 2026-09-13 against the unchanged supplier API:
//   GET /api/all/0_5        → row id_number "BAS 00132206", price_1mg 28,
//                             price_5mg 84, price_10mg 224 (no price_2mg)
//   POST /api4/bas          → same compound, price_1mg 170, price_2mg 194,
//                             price_5mg 218, price_10mg 242
// The page displays whichever response the row arrived in; nothing here is
// hardcoded — these fixtures mirror the measured payloads.
const browseRow = {
  id: 1,
  id_number: 'BAS 00132206',
  smiles_string: 'COc1cc(ncn1)N/N=C/c2ccccc2O',
  brutto_formula: 'C12 H12 N4 O2',
  price_1mg: 28,
  price_5mg: 84,
  price_10mg: 224,
};
// The page normalizer (simulation.jsx normalizeCatalogMolecule) owns field
// mapping; the cart helper receives its output.
const normalizedRow = {
  ...browseRow,
  ASINEX_ID: browseRow.id_number,
  SMILES_STRING: browseRow.smiles_string,
  BRUTTO_FORMULA: browseRow.brutto_formula,
};
check('catalogOfferCode prefers the BAS code', catalogOfferCode({ BAS_CODE: 'BAS 00132206' }) === 'BAS 00132206');
check('catalogOfferCode falls back to id_number for browse rows', catalogOfferCode(browseRow) === 'BAS 00132206');
check('catalogOfferCode trims and rejects N/A/empty', catalogOfferCode({ BAS_CODE: '  BAS 00500692 ' }) === 'BAS 00500692' && catalogOfferCode({ BAS_CODE: 'N/A' }) === '' && catalogOfferCode({}) === '');

const browseItems = [1, 5, 10].map((amountMg) => cartItemFromCatalogPrice(
  normalizedRow,
  amountMg,
  normalizedRow[`price_${amountMg}mg`],
));
check('browse row baskets the catalog prices $28/$84/$224 for 1/5/10 mg', browseItems[0]?.totalPrice === 28 && browseItems[1]?.totalPrice === 84 && browseItems[2]?.totalPrice === 224, JSON.stringify(browseItems.map((i) => i?.totalPrice)));
check('cart item checks out by the catalog BAS code', browseItems.every((i) => i?.catalogId === 'BAS 00132206' && i?.id === 'BAS 00132206'));
check('cart item is labelled source: catalog', browseItems.every((i) => i?.source === 'catalog'));
check('cart item keeps pack USD without multiplying', browseItems[1]?.amount === 5 && browseItems[1]?.price === 84 && browseItems[1]?.pricePerMg === 84);
check('cart item keeps formula name + structure', browseItems[0]?.name === 'C12 H12 N4 O2' && browseItems[0]?.smiles.startsWith('COc1cc'));
check('missing pack price cannot be added (browse rows have no 2 mg)', cartItemFromCatalogPrice(normalizedRow, 2, undefined) === null);
check('zero or negative price cannot be added', cartItemFromCatalogPrice(normalizedRow, 1, 0) === null && cartItemFromCatalogPrice(normalizedRow, 1, -28) === null);
check('off-allowlist pack amount rejected', cartItemFromCatalogPrice(normalizedRow, 3, 50) === null);
check('row without a catalog code cannot be added', cartItemFromCatalogPrice({ PRICE_1MG: 28 }, 1, 28) === null);

// ── Navbar 409 price-review behaviour (client/src/utils/moleculeCart.js) ─────
// Source-agnostic: whatever the server validates prices against, a changed
// basket answers 409 MOLECULE_PRICES_CHANGED and the navbar adopts the rows.
const {
  cartItemsFromPriceReview,
  persistMoleculeCart,
} = await import(pathToFileURL(path.join(root, 'client/src/utils/moleculeCart.js')).href);

const storageStub = (initial) => {
  const map = new Map(Object.entries(initial ?? {}));
  return {
    getItem: (key) => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => { map.set(key, value); },
  };
};

const reviewPayload = {
  code: 'MOLECULE_PRICES_CHANGED',
  error: 'Supplier prices have changed. Review the updated basket before continuing to checkout.',
  totalAmount: 112,
  updatedCartItems: [
    { name: 'C12 H12 N4 O2', catalogId: 'BAS 00132206', amount: 1, price: 28, pricePerMg: 28, totalPrice: 28, source: 'catalog' },
    { name: 'C7 H6 O2', catalogId: 'BAS 30906909', amount: 5, price: 84, pricePerMg: 84, totalPrice: 84, source: 'catalog' },
  ],
};
const reviewed = cartItemsFromPriceReview(reviewPayload);
check('review helper adopts the re-priced rows', reviewed?.items?.length === 2 && reviewed?.items[0]?.totalPrice === 28);
check('review helper uses the authoritative server total', reviewed?.total === 112);
check('review helper falls back to the displayed sum without totalAmount', cartItemsFromPriceReview({
  updatedCartItems: reviewPayload.updatedCartItems,
})?.total === 112);
check(
  'review helper rejects unusable payloads',
  cartItemsFromPriceReview(null) === null
    && cartItemsFromPriceReview({}) === null
    && cartItemsFromPriceReview({ updatedCartItems: [] }) === null
    && cartItemsFromPriceReview({ updatedCartItems: ['not-an-object'] }) === null,
);

const arrayStore = storageStub({ moleculeCart: JSON.stringify([{ totalPrice: 1 }]) });
check('persist keeps array-shaped carts array-shaped', persistMoleculeCart(arrayStore, reviewPayload.updatedCartItems, 112) && Array.isArray(JSON.parse(arrayStore.getItem('moleculeCart'))));
const objectStore = storageStub({ moleculeCart: JSON.stringify({ items: [{ totalPrice: 1 }], total: 1 }) });
const persistedObject = persistMoleculeCart(objectStore, reviewPayload.updatedCartItems, 112)
  ? JSON.parse(objectStore.getItem('moleculeCart'))
  : null;
check('persist keeps {items,total}-shaped carts and refreshes the total', Array.isArray(persistedObject?.items) && persistedObject?.total === 112);
const emptyStore = storageStub();
persistMoleculeCart(emptyStore, reviewPayload.updatedCartItems, 112);
const emptyStored = JSON.parse(emptyStore.getItem('moleculeCart'));
check('empty storage defaults to the navbar object shape', !Array.isArray(emptyStored) && emptyStored?.total === 112);
check('storage failures are reported, not thrown', persistMoleculeCart({ getItem: () => { throw new Error('quota'); }, setItem: () => {} }, [], 0) === false);

// Execute the actual navbar handler without a browser publishable key.
const handlerSource = dashboardNavbar.split('  const handleCheckout = async () => {')[1].split('\n  const logout =')[0].trim().replace(/};$/, '');
const checkoutWindow = { location: { href: '' }, clearTimeout() {}, setTimeout() { return 1; } };
let checkoutRequest;
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
const runCheckout = new AsyncFunction('cartItems', 'window', 'cartRequestControllerRef', 'cartTimeoutRef', 'CART_FETCH_TIMEOUT_MS', 'setCartAction', 'getAuthToken', 'API_CONFIG', 'fetch', 'showActionMessage', handlerSource);
await runCheckout([{ catalogId: 'BAS 00132206', amount: 1, totalPrice: 28 }], checkoutWindow, { current: null }, { current: null }, 30000, () => {}, () => 'fixture-token', { buildUrl: p => p }, async (url, options) => {
  checkoutRequest = { url, options };
  return { ok: true, json: async () => ({ url: 'https://checkout.stripe.com/fixture-review' }) };
}, () => {});
check('checkout without a publishable key reaches authenticated server endpoint', checkoutRequest?.url === '/create-checkout-session-onetime' && checkoutRequest.options.headers.Authorization === 'Bearer fixture-token');
check('checkout redirects to server-created hosted review URL', checkoutWindow.location.href === 'https://checkout.stripe.com/fixture-review');

console.log(`\nsimulation pricing lifecycle: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
