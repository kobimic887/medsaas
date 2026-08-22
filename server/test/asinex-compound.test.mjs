// Unit tests for the reverse-engineered ASINEX pricing + normalisation helpers
// (server/utils/asinexCompound.js). Pure functions — no server boot, no MongoDB.
//
// Run: SERVER_RUNTIME=bun bun test/asinex-compound.test.mjs

import {
  ASINEX_PRICE_TABLE,
  ASINEX_SHIPPING_USD,
  MAX_MOLECULE_CART_ITEMS,
  catalogRowsFromResponse,
  normalizeMoleculeCartRequest,
  priceForCategory,
  priceMoleculeCart,
  priceTableForCategory,
  normalizeShopCompound,
  normalizeShopSearchResponse
} from '../utils/asinexCompound.js';

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

function checkThrows(label, fn, expectedMessage) {
  try {
    fn();
    check(label, false, '(did not throw)');
  } catch (error) {
    check(label, error.message.includes(expectedMessage), `(${error.message})`);
  }
}

console.log('ASINEX pricing + normalisation:\n');

// --- pricing table: every (category, weight), from Price.js CalcPrice ---
const EXPECTED = {
  1: { 1: 100, 2: 120, 5: 140, 10: 160 },
  2: { 1: 160, 2: 185, 5: 210, 10: 235 },
  3: { 1: 200, 2: 240, 5: 280, 10: 320 }
};
for (const cat of [1, 2, 3]) {
  for (const w of [1, 2, 5, 10]) {
    check(`price cat ${cat} @ ${w}mg = $${EXPECTED[cat][w]}`, priceForCategory(cat, w) === EXPECTED[cat][w]);
  }
}
check('shipping surcharge is $50', ASINEX_SHIPPING_USD === 50);
check('string inputs are coerced', priceForCategory('2', '5') === 210);
check('price table is frozen', Object.isFrozen(ASINEX_PRICE_TABLE));

// --- invalid inputs -> null (never throw, never guess a price) ---
check('unknown category -> null', priceForCategory(99, 1) === null);
check('unsupported weight -> null', priceForCategory(1, 3) === null);
check('null category -> null', priceForCategory(null, 1) === null);
check('priceTableForCategory(2)', JSON.stringify(priceTableForCategory(2)) === JSON.stringify({ 1: 160, 2: 185, 5: 210, 10: 235 }));
check('priceTableForCategory(unknown) -> null', priceTableForCategory(7) === null);

// --- normalizeShopCompound: legacy casing -> clean + server-computed prices ---
const legacy = {
  elE_ID: 123,
  baS_CODE: 'BAS 12345678',
  molwt: 350.2,
  molformula: 'C18H20N2O4',
  available: 42,
  availablE_STRING: '42',
  clogp: 2.1,
  hac: 4,
  price_category: 1,
  salt: ''
};
const norm = normalizeShopCompound(legacy);
check('eleId mapped', norm.eleId === 123);
check('basCode mapped', norm.basCode === 'BAS 12345678');
check('molWeight mapped', norm.molWeight === 350.2);
check('molFormula mapped', norm.molFormula === 'C18H20N2O4');
check('availableMg mapped', norm.availableMg === 42);
check('priceCategory mapped', norm.priceCategory === 1);
check('server prices attached from category', JSON.stringify(norm.prices) === JSON.stringify({ 1: 100, 2: 120, 5: 140, 10: 160 }));
check('non-object input passes through', normalizeShopCompound(null) === null);

// --- normalizeShopSearchResponse: list normalised, unknown shape untouched ---
const resp = normalizeShopSearchResponse({ list: [legacy], found: 1, totalFound: 1 });
check('response list normalised', resp.list[0].eleId === 123 && resp.list[0].prices[5] === 140);
check('response found preserved', resp.found === 1);
const unknown = { something: 'else' };
check('unknown shape passes through unchanged', normalizeShopSearchResponse(unknown) === unknown);
check('null passes through', normalizeShopSearchResponse(null) === null);

// --- molecule checkout: browser totals/names are untrusted ---
const requestedCart = normalizeMoleculeCartRequest([
  { catalogId: 'BAS 00132206', amount: 5, totalPrice: 0.01, name: 'forged' },
  { moleculeId: 17529, amount: '1', price: 0.01 },
]);
check('cart keeps only catalog identity and package size', JSON.stringify(requestedCart) === JSON.stringify([
  { catalogId: 'BAS 00132206', amount: 5 },
  { catalogId: '17529', amount: 1 },
]));
check('cart size is bounded', MAX_MOLECULE_CART_ITEMS === 100);
checkThrows('empty molecule cart rejected', () => normalizeMoleculeCartRequest([]), 'empty');
checkThrows('unsupported package size rejected', () => normalizeMoleculeCartRequest([{ catalogId: 'BAS 1', amount: 3 }]), 'unsupported');
checkThrows('missing catalog ID rejected', () => normalizeMoleculeCartRequest([{ amount: 1 }]), 'catalog ID');

const pricedOrder = priceMoleculeCart(requestedCart, [
  { ASINEX_ID: 'BAS 00132206', BRUTTO_FORMULA: 'C10H12O', PRICE_5MG: 39.02 },
  { id_number: 17529, brutto_formula: 'C2H6O', price_1mg: '13.00' },
]);
check('server catalog prices replace forged totals', pricedOrder.totalCents === 5202);
check('checkout is itemized with server prices', pricedOrder.lineItems.length === 2 && pricedOrder.lineItems[0].price_data.unit_amount === 3902);
check('checkout line carries catalog identity and amount', pricedOrder.lineItems[0].price_data.product_data.name === 'BAS 00132206 · 5 mg');
check('checkout matches BAS_CODE response shapes', priceMoleculeCart(
  [{ catalogId: 'BAS 00999999', amount: 1 }],
  [{ BAS_CODE: 'BAS 00999999', PRICE_1MG: 12 }],
).totalCents === 1200);
const liveBasShape = {
  id: 17529,
  bas_code: 'BAS 00132206',
  price_1mg: 170,
  price_2mg: 194,
  price_5mg: 218,
  price_10mg: 242,
  smiles_string: 'COc1cc(ncn1)N/N=C/c2ccccc2O',
  brutto_formula: 'C12 H12 N4 O2',
};
const liveShapeOrder = priceMoleculeCart([{ catalogId: 'BAS 00132206', amount: 5 }], [liveBasShape]);
check('checkout matches the measured lowercase ASINEX BAS shape', liveShapeOrder.totalCents === 21800);
check('measured BAS checkout keeps the catalog code in Stripe', liveShapeOrder.lineItems[0].price_data.product_data.name === 'BAS 00132206 · 5 mg');
const legacySmiles = liveBasShape.smiles_string;
const legacyCart = normalizeMoleculeCartRequest([
  { catalogId: '17529', amount: 5, smiles: legacySmiles, price: 0.01, totalPrice: 0.01 },
]);
check('legacy cart keeps bounded SMILES for authoritative re-resolution', JSON.stringify(legacyCart) === JSON.stringify([
  { catalogId: '17529', amount: 5, smiles: legacySmiles },
]));
check('legacy numeric cart can be priced from its exact resolved structure', priceMoleculeCart(
  legacyCart,
  [liveBasShape],
).totalCents === 21800);
checkThrows('oversized legacy SMILES rejected', () => normalizeMoleculeCartRequest([
  { catalogId: '17529', amount: 5, smiles: 'C'.repeat(5001) },
]), 'invalid SMILES');
check('catalog rows accept a direct ASINEX object', catalogRowsFromResponse(liveBasShape)[0] === liveBasShape);
check('catalog rows accept an ASINEX array', catalogRowsFromResponse([liveBasShape])[0] === liveBasShape);
check('catalog rows accept a data wrapper', catalogRowsFromResponse({ data: [liveBasShape] })[0] === liveBasShape);
check('catalog rows accept a molecules wrapper', catalogRowsFromResponse({ molecules: [liveBasShape] })[0] === liveBasShape);
check('catalog rows normalize empty and unknown payloads', catalogRowsFromResponse(null).length === 0 && catalogRowsFromResponse({ ok: true }).length === 0);
checkThrows('missing catalog compound rejected', () => priceMoleculeCart([{ catalogId: 'missing', amount: 1 }], []), 'no longer in the catalog');
checkThrows('missing authoritative price rejected', () => priceMoleculeCart([{ catalogId: 'BAS 1', amount: 10 }], [{ ASINEX_ID: 'BAS 1' }]), 'no valid 10 mg price');

console.log('\n================================================');
console.log(`Result: ${passed} passed, ${failed} failed`);
console.log('================================================');
process.exit(failed === 0 ? 0 : 1);
