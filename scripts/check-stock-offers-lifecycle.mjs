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
const serverOffers = readFileSync(
  path.join(root, 'server/utils/stockOffers.js'),
  'utf8',
);
const asinexCompound = readFileSync(
  path.join(root, 'server/utils/asinexCompound.js'),
  'utf8',
);
const indexJs = readFileSync(path.join(root, 'server/index.js'), 'utf8');
const stagingDemo = readFileSync(
  path.join(root, 'server/routes/stagingDemo.js'),
  'utf8',
);
const dashboardNavbar = readFileSync(
  path.join(root, 'client/src/widgets/layout/dashboard-navbar.jsx'),
  'utf8',
);
const moleculeCartUtil = readFileSync(
  path.join(root, 'client/src/utils/moleculeCart.js'),
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

console.log('Stock offers lifecycle (Simulation purchase + cart, stock + Internal catalog):\n');

check('simulation imports stockOffers helpers', simulation.includes("from '@/utils/stockOffers'"));
check('purchase column header present', simulation.includes('>Purchase</'));
check('offers fetched via authenticated /stock-offers', simulation.includes("/stock-offers") && simulation.includes('Authorization'));
check('offers state map drives purchase cells', simulation.includes('stockOffersByCode'));
check('pack buttons use packsFromStockOffer', simulation.includes('packsFromStockOffer(offer)'));
check('addToCart accepts offer for stock packs', simulation.includes('addToCart(mol, pack.amountMg, pack.priceUSD, offer)'));
check('unresolved codes show Quote required', simulation.includes('Quote required'));
check('resolved empty packs show Price unavailable', simulation.includes('Price unavailable'));
check('header no longer claims stock is not purchasable', !simulation.includes('not purchasable in this flow'));
check('header mentions live supplier quotes', simulation.includes('live supplier quotes'));
check('quote effect covers stock AND asinex sources', simulation.includes("searchSource !== 'stock' && searchSource !== 'asinex'"));
check('catalog quote codes use the BAS-first catalogOfferCode', simulation.includes(': catalogOfferCode(mol)'));
check('catalog price cells render from live offers', simulation.includes('catalogPriceCell(mol, 1)') && simulation.includes('catalogPriceCell(mol, 5)') && simulation.includes('catalogPriceCell(mol, 10)'));
check('catalog basket add uses the quoted price', simulation.includes('addToCart(mol, amountMg, packPrice, offer, { catalogRow: true })'));
check('catalog loading state is visible per cell', simulation.includes('aria-label="Loading live prices"'));
check('failed quote batch shows retry banner, never old prices', simulation.includes('Retry live prices') && simulation.includes('Old snapshot prices are never shown instead'));
check('retry refetches unresolved codes', simulation.includes('setOffersRetryTick') && simulation.includes('offersRetryTick]'));
check('snapshot PRICE_* cart buttons are gone', !simulation.includes('addToCart(mol, 1, mol.PRICE_1MG)') && !simulation.includes('addToCart(mol, 5, mol.PRICE_5MG)') && !simulation.includes('addToCart(mol, 10, mol.PRICE_10MG)'));
check('catalog row normalizer drops snapshot prices', !simulation.includes('PRICE_1MG: molecule.PRICE_1MG'));
check('cartItemFromStockOffer keeps stockCode', stockOffersUtil.includes('stockCode: code') && stockOffersUtil.includes("source: 'stock'"));
check('cartItemFromCatalogOffer keeps BAS code + source', stockOffersUtil.includes('catalogOfferCode(molecule)') && stockOffersUtil.includes("source: 'catalog'"));
check('priceFromStockOffer reads one pack price', stockOffersUtil.includes('export function priceFromStockOffer'));
check('server resolveStockOffers posts /api4/bas', serverOffers.includes('/api4/bas'));
check('checkout re-prices via priceMoleculeCartFromOffers', indexJs.includes('priceMoleculeCartFromOffers'));
check('checkout blocks stale basket with 409 MOLECULE_PRICES_CHANGED', indexJs.includes('moleculeCartPriceReview') && indexJs.includes('MOLECULE_PRICES_CHANGED'));
// The 409 return must sit between the offer re-pricing and this route's Stripe
// call, so a review block can never create a Stripe session.
const reviewIdx = indexJs.indexOf("code: 'MOLECULE_PRICES_CHANGED'");
const stripeAfterReviewIdx = reviewIdx > -1 ? indexJs.indexOf('stripe.checkout.sessions.create', reviewIdx) : -1;
check('409 review precedes the molecule Stripe session call', reviewIdx > -1 && stripeAfterReviewIdx > -1);
check('POST /api/stock-offers route registered', indexJs.includes("app.post('/api/stock-offers'"));
check('staging refuses /api/stock-offers', stagingDemo.includes('"/api/stock-offers"'));
check('navbar keys the review branch on 409 + MOLECULE_PRICES_CHANGED', dashboardNavbar.includes("response.status === 409 && errorData.code === 'MOLECULE_PRICES_CHANGED'"));
check('navbar adopts re-priced rows via the moleculeCart util', dashboardNavbar.includes('cartItemsFromPriceReview') && dashboardNavbar.includes('persistMoleculeCart') && moleculeCartUtil.includes('updatedCartItems'));
check('navbar persists refreshed basket and notifies views', dashboardNavbar.includes("dispatchEvent(new Event('cartUpdated'))"));
check('navbar review notice is sticky and never auto-continues', dashboardNavbar.includes("'warning', 0)") && dashboardNavbar.includes('color={actionMessageType === "error" ? "red" : actionMessageType === "warning" ? "amber" : "green"}'));
check('server rejects explicit quantity other than numeric 1', asinexCompound.includes('item.quantity !== undefined && item.quantity !== 1'));

const {
  cartItemFromStockOffer,
  cartItemFromCatalogOffer,
  catalogOfferCode,
  packsFromStockOffer,
  priceFromStockOffer,
} = await import(pathToFileURL(path.join(root, 'client/src/utils/stockOffers.js')).href);

const offer = {
  offerId: 2081,
  code: 'ASN 33727025',
  packs: [
    { amountMg: 1, priceUSD: 170 },
    { amountMg: 5, priceUSD: 218 },
    { amountMg: 3, priceUSD: 99 },
    { amountMg: 10, priceUSD: 0 },
  ],
  smiles: 'C1CCC(=O)NC2CCNC2C1',
  formula: 'C9 H16 N2 O',
};
const packs = packsFromStockOffer(offer);
check('client packs filter to positive 1/2/5/10 only', packs.length === 2 && packs[0].amountMg === 1 && packs[1].amountMg === 5);

const item = cartItemFromStockOffer(
  { stockCode: 'ASN 33727025', SMILES_STRING: 'CCO' },
  5,
  218,
  offer,
);
check('cart item retains original stock code', item?.catalogId === 'ASN 33727025' && item?.name === 'ASN 33727025' && item?.source === 'stock');
check('cart item keeps pack USD without multiplying', item?.totalPrice === 218 && item?.amount === 5);
check('invalid pack amount rejected', cartItemFromStockOffer({ stockCode: 'ASN 1' }, 3, 10, offer) === null);

// ── Internal catalog priced from the same live offers ────────────────────────
// Regression 2026-09-13: BAS 00132206 must show/basket the authoritative
// /api4/bas quote $170/$218/$242 (1/5/10 mg), superseding the stale snapshot
// $28/$84/$224. A failed quote must never fall back to the snapshot prices.
const catalogMolecule = {
  BAS_CODE: 'BAS 00132206',
  ASINEX_ID: 'BAS 00132206',
  SMILES_STRING: 'CCOCCCNCC(=O)Nc1ccccc1N2CCOCC2',
  BRUTTO_FORMULA: 'C17 H27 N3 O3',
  // Stale snapshot fields the row must ignore even if upstream still sends them.
  PRICE_1MG: 28,
  PRICE_5MG: 84,
  PRICE_10MG: 224,
};
const catalogOffer = {
  offerId: 32336,
  code: 'BAS 00132206',
  packs: [
    { amountMg: 1, priceUSD: 170 },
    { amountMg: 5, priceUSD: 218 },
    { amountMg: 10, priceUSD: 242 },
  ],
};

check('catalogOfferCode prefers the BAS code', catalogOfferCode(catalogMolecule) === 'BAS 00132206');
check('catalogOfferCode trims and rejects N/A/empty', catalogOfferCode({ BAS_CODE: '  BAS 00500692 ' }) === 'BAS 00500692' && catalogOfferCode({ BAS_CODE: 'N/A' }) === '' && catalogOfferCode({}) === '');
check('catalogOfferCode falls back to ASINEX_ID then id_number', catalogOfferCode({ ASINEX_ID: 'ASN 04188606' }) === 'ASN 04188606' && catalogOfferCode({ id_number: 12345 }) === '12345');

check('live 1 mg quote is 170', priceFromStockOffer(catalogOffer, 1) === 170);
check('live 5 mg quote is 218', priceFromStockOffer(catalogOffer, 5) === 218);
check('live 10 mg quote is 242', priceFromStockOffer(catalogOffer, 10) === 242);
check('missing 2 mg pack reads as null (no invented price)', priceFromStockOffer(catalogOffer, 2) === null);
check('null offer reads as null (failed/unresolved quote)', priceFromStockOffer(null, 5) === null);

const catalogItems = [1, 5, 10].map((amountMg) => cartItemFromCatalogOffer(
  catalogMolecule,
  amountMg,
  priceFromStockOffer(catalogOffer, amountMg),
  catalogOffer,
));
check(
  'BAS 00132206 baskets authoritative $170/$218/$242 for 1/5/10 mg',
  catalogItems[0]?.totalPrice === 170 && catalogItems[1]?.totalPrice === 218 && catalogItems[2]?.totalPrice === 242,
  JSON.stringify(catalogItems.map((i) => i?.totalPrice)),
);
check('stale snapshot $28/$84/$224 never reach the basket', catalogItems.every((i) => ![28, 84, 224].includes(i?.totalPrice)));
check('catalog cart item checks out by the quoted BAS code', catalogItems.every((i) => i?.catalogId === 'BAS 00132206' && i?.id === 'BAS 00132206'));
check('catalog cart item is labelled source: catalog', catalogItems.every((i) => i?.source === 'catalog' && i?.offerId === 32336));
check('catalog cart item keeps pack USD without multiplying', catalogItems[1]?.amount === 5 && catalogItems[1]?.price === 218 && catalogItems[1]?.pricePerMg === 218);
check('catalog cart item keeps formula name + structure', catalogItems[0]?.name === 'C17 H27 N3 O3' && catalogItems[0]?.smiles.includes('CCOCCCNCC'));
check('zero-price quote cannot be added (no fallback path)', cartItemFromCatalogOffer(catalogMolecule, 1, 0, catalogOffer) === null);
check('snapshot price passed as price is still rejected when non-positive', cartItemFromCatalogOffer(catalogMolecule, 1, -28, catalogOffer) === null);
check('row without a supplier code cannot be quoted or added', cartItemFromCatalogOffer({ PRICE_1MG: 28 }, 1, 170, catalogOffer) === null);

// ── Navbar 409 price-review behaviour (client/src/utils/moleculeCart.js) ─────
// Real behaviour of the helpers the navbar's checkout error path calls, run
// against an injected storage so no browser is needed.
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
  totalAmount: 436,
  updatedCartItems: [
    { name: 'BAS 00132206', catalogId: 'BAS 00132206', amount: 5, price: 218, pricePerMg: 218, totalPrice: 218, source: 'catalog', offerId: 32336 },
    { name: 'ASN 33727025', catalogId: 'ASN 33727025', amount: 1, price: 170, pricePerMg: 170, totalPrice: 170, source: 'stock' },
  ],
};
const reviewed = cartItemsFromPriceReview(reviewPayload);
check('review helper adopts the re-priced rows', reviewed?.items?.length === 2 && reviewed?.items[0]?.totalPrice === 218);
check('review helper uses the authoritative server total', reviewed?.total === 436);
check('review helper falls back to the displayed sum without totalAmount', cartItemsFromPriceReview({
  updatedCartItems: reviewPayload.updatedCartItems,
})?.total === 388);
check(
  'review helper rejects unusable payloads',
  cartItemsFromPriceReview(null) === null
    && cartItemsFromPriceReview({}) === null
    && cartItemsFromPriceReview({ updatedCartItems: [] }) === null
    && cartItemsFromPriceReview({ updatedCartItems: ['not-an-object'] }) === null,
);

const arrayStore = storageStub({ moleculeCart: JSON.stringify([{ totalPrice: 1 }]) });
check('persist keeps array-shaped carts array-shaped', persistMoleculeCart(arrayStore, reviewPayload.updatedCartItems, 436) && Array.isArray(JSON.parse(arrayStore.getItem('moleculeCart'))));
const objectStore = storageStub({ moleculeCart: JSON.stringify({ items: [{ totalPrice: 1 }], total: 1 }) });
const persistedObject = persistMoleculeCart(objectStore, reviewPayload.updatedCartItems, 436)
  ? JSON.parse(objectStore.getItem('moleculeCart'))
  : null;
check('persist keeps {items,total}-shaped carts and refreshes the total', Array.isArray(persistedObject?.items) && persistedObject?.total === 436);
const emptyStore = storageStub();
persistMoleculeCart(emptyStore, reviewPayload.updatedCartItems, 436);
const emptyStored = JSON.parse(emptyStore.getItem('moleculeCart'));
check('empty storage defaults to the navbar object shape', !Array.isArray(emptyStored) && emptyStored?.total === 436);
check('storage failures are reported, not thrown', persistMoleculeCart({ getItem: () => { throw new Error('quota'); }, setItem: () => {} }, [], 0) === false);

console.log(`\nstock-offers lifecycle: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
