// Unit tests for the reverse-engineered ASINEX pricing + normalisation helpers
// (server/utils/asinexCompound.js). Pure functions — no server boot, no MongoDB.
//
// Run: SERVER_RUNTIME=bun bun test/asinex-compound.test.mjs

import {
  ASINEX_PRICE_TABLE,
  ASINEX_SHIPPING_USD,
  priceForCategory,
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

console.log('\n================================================');
console.log(`Result: ${passed} passed, ${failed} failed`);
console.log('================================================');
process.exit(failed === 0 ? 0 : 1);
