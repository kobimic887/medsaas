// server/utils/catalogPricing.js unit tests — checkout pricing from the
// original Asinex catalog API (GET /api/id/<code>), stock-origin rejection.
// Prices used are REAL per-compound catalog values measured live 2026-09-13
// (BAS 00293357: 22/66/176 USD for 1/5/10 mg; LAS 30881879: 20/60/160).
// Run: SERVER_RUNTIME=bun bun test/catalog-pricing.test.mjs

import {
  normalizeCatalogCode,
  isStockOriginCartItem,
  catalogCompoundFromIdRow,
  resolveCatalogCompoundsByCode,
  priceMoleculeCartFromCatalog,
  MoleculeCartStockItemsError,
  CatalogPricingValidationError,
  CatalogPricingUpstreamError,
} from '../utils/catalogPricing.js';

let passed = 0;
let failed = 0;
function check(label, cond, extra = '') {
  if (cond) {
    console.log(`  ✓ ${label}`);
    passed += 1;
  } else {
    console.log(`  ✗ ${label} ${extra}`);
    failed += 1;
  }
}

async function expectError(label, promise, ctor, extraAssert) {
  try {
    await promise;
    check(label, false, '(no error thrown)');
  } catch (err) {
    check(
      label,
      err instanceof ctor && (!extraAssert || extraAssert(err)),
      `(got ${err?.constructor?.name}: ${err?.message})`,
    );
  }
}

// ── code normalization ───────────────────────────────────────────────────────
check('code keeps prefix and inner space', normalizeCatalogCode('  BAS   00293357 ') === 'BAS 00293357');
check('code rejects N/A and empty', normalizeCatalogCode('N/A') === '' && normalizeCatalogCode('') === '' && normalizeCatalogCode(null) === '');
check('code rejects >64 chars', normalizeCatalogCode('B'.repeat(65)) === '');

// ── stock-origin classification (basket shapes) ──────────────────────────────
check('source stock → stock-origin', isStockOriginCartItem({ source: 'stock', catalogId: 'ASN 1' }));
check('legacy row without source and without stockCode → catalog', !isStockOriginCartItem({ catalogId: 'BAS 00293357', totalPrice: 22 }));
check('source-less row with stockCode marker → stock-origin (never silently converted)', isStockOriginCartItem({ catalogId: 'ASN 1', stockCode: 'ASN 1' }));
check('catalog source row → catalog', !isStockOriginCartItem({ source: 'catalog', catalogId: 'BAS 00293357' }));
check('unknown source value → catalog (code lookup decides)', !isStockOriginCartItem({ source: 'open', catalogId: 'X 1' }));
check('null/invalid row → not stock', !isStockOriginCartItem(null) && !isStockOriginCartItem('x'));

// ── /api/id row normalization ────────────────────────────────────────────────
const measuredRow = {
  id: 2,
  id_number: 'BAS 00293357',
  smiles_string: 'C#Cc1ccc(cc1)C#C',
  available_mg: 42.3,
  mol_weight: 126.155,
  brutto_formula: 'C10 H6',
  price_1mg: 22,
  price_5mg: 66,
  price_10mg: 176,
};
const compound = catalogCompoundFromIdRow(measuredRow);
check('row keeps the id_number code', compound?.id_number === 'BAS 00293357' && compound?.ASINEX_ID === 'BAS 00293357');
check('row keeps measured pack prices', compound?.price_1mg === 22 && compound?.price_5mg === 66 && compound?.price_10mg === 176);
check('row invents no 2 mg price (measured rows have none)', compound?.price_2mg === undefined);
check('row keeps structure + formula', compound?.smiles_string === 'C#Cc1ccc(cc1)C#C' && compound?.brutto_formula === 'C10 H6');
check('row without a code is unusable', catalogCompoundFromIdRow({ price_1mg: 22 }) === null);
check(
  'uppercase snapshot casing also prices',
  catalogCompoundFromIdRow({ id_number: 'BAS 1', PRICE_1MG: 22 })?.price_1mg === 22,
);
check('non-positive prices are dropped, not zeroed', catalogCompoundFromIdRow({ id_number: 'BAS 1', price_1mg: 0 })?.price_1mg === undefined);

// ── resolveCatalogCompoundsByCode with injected fetch ────────────────────────
{
  const calls = [];
  const rows = {
    'BAS 00293357': measuredRow,
    'LAS 30881879': { id: 19009, id_number: 'LAS 30881879', price_1mg: 20, price_5mg: 60, price_10mg: 160 },
  };
  const fetchImpl = async (url) => {
    calls.push(url);
    const code = decodeURIComponent(url.split('/api/id/')[1] || '');
    const row = rows[code];
    return { ok: true, status: 200, text: async () => (row ? JSON.stringify(row) : '') };
  };
  const { compounds, unresolvedCodes } = await resolveCatalogCompoundsByCode(
    ['BAS 00293357', 'LAS 30881879', 'BAS 99999999'],
    { catalogApiBase: 'http://catalog.test', fetchImpl },
  );
  check('lookups hit GET /api/id with the URL-encoded code (prefix + space intact)', calls.every((u) => u.startsWith('http://catalog.test/api/id/')) && calls.some((u) => u.endsWith('/api/id/BAS%2000293357')));
  check('two codes resolved to catalog rows', compounds.length === 2 && compounds[0].id_number === 'BAS 00293357' && compounds[1].id_number === 'LAS 30881879');
  check('unknown code (200 + empty body) is unresolved, never a price', JSON.stringify(unresolvedCodes) === JSON.stringify(['BAS 99999999']));
}

{
  let calls = 0;
  const fetchImpl = async () => { calls += 1; throw new Error('boom'); };
  await expectError(
    'network failure → CatalogPricingUpstreamError',
    resolveCatalogCompoundsByCode(['BAS 00293357'], { catalogApiBase: 'http://catalog.test', fetchImpl }),
    CatalogPricingUpstreamError,
  );
  check('upstream failure aborts pricing (no partial results)', calls === 1);
}

{
  const fetchImpl = async () => ({ ok: false, status: 503, text: async () => '' });
  await expectError(
    'upstream 5xx → CatalogPricingUpstreamError',
    resolveCatalogCompoundsByCode(['BAS 00293357'], { catalogApiBase: 'http://catalog.test', fetchImpl }),
    CatalogPricingUpstreamError,
    (err) => err.status === 503,
  );
}

{
  const fetchImpl = async () => ({ ok: true, status: 200, text: async () => '<html>' });
  await expectError(
    'non-JSON body → CatalogPricingUpstreamError',
    resolveCatalogCompoundsByCode(['BAS 00293357'], { catalogApiBase: 'http://catalog.test', fetchImpl }),
    CatalogPricingUpstreamError,
  );
}

await expectError(
  'missing catalog base → upstream error',
  resolveCatalogCompoundsByCode(['BAS 1'], { catalogApiBase: '', fetchImpl: async () => { throw new Error('x'); } }),
  CatalogPricingUpstreamError,
);
await expectError(
  'no codes → validation error',
  resolveCatalogCompoundsByCode([], { catalogApiBase: 'http://catalog.test', fetchImpl: async () => { throw new Error('x'); } }),
  CatalogPricingValidationError,
);

// ── priceMoleculeCartFromCatalog ─────────────────────────────────────────────
const fetchCounter = () => {
  const state = { calls: [] };
  const fetchImpl = async (url) => {
    state.calls.push(url);
    if (url.includes('BAS%2000293357')) {
      return { ok: true, status: 200, text: async () => JSON.stringify(measuredRow) };
    }
    if (url.includes('LAS%2030881879')) {
      return { ok: true, status: 200, text: async () => JSON.stringify({ id: 19009, id_number: 'LAS 30881879', price_1mg: 20, price_5mg: 60, price_10mg: 160 }) };
    }
    return { ok: true, status: 200, text: async () => '' };
  };
  return { state, fetchImpl };
};

{
  const { state, fetchImpl } = fetchCounter();
  await expectError(
    'stock-origin row is refused before any network call',
    priceMoleculeCartFromCatalog(
      [{ source: 'stock', catalogId: 'ASN 33727025', amount: 1, totalPrice: 170, name: 'ASN 33727025' }],
      { catalogApiBase: 'http://catalog.test', fetchImpl },
    ),
    MoleculeCartStockItemsError,
    (err) => err.unsupportedItems?.[0]?.catalogId === 'ASN 33727025'
      && err.unsupportedItems?.[0]?.index === 0
      && err.message.toLowerCase().includes('remove'),
  );
  check('stock rejection makes zero upstream calls', state.calls.length === 0);
}

{
  const { state, fetchImpl } = fetchCounter();
  await expectError(
    'mixed basket: catalog row alongside a stock row is still refused whole',
    priceMoleculeCartFromCatalog(
      [
        { catalogId: 'BAS 00293357', amount: 1, totalPrice: 22 },
        { source: 'stock', catalogId: 'ASN 33727025', amount: 1, totalPrice: 170 },
      ],
      { catalogApiBase: 'http://catalog.test', fetchImpl },
    ),
    MoleculeCartStockItemsError,
  );
  check('no pricing happened for the catalog row either', state.calls.length === 0);
}

{
  const { fetchImpl } = fetchCounter();
  const priced = await priceMoleculeCartFromCatalog(
    [
      // New catalog-row shape (source catalog) at the displayed catalog price.
      { source: 'catalog', catalogId: 'BAS 00293357', amount: 5, price: 66, pricePerMg: 66, totalPrice: 66, name: 'C10 H6' },
      // Legacy controlpanel shape: no source field at all.
      { catalogId: 'LAS 30881879', amount: 1, pricePerMg: 20, totalPrice: 20, name: 'LAS 30881879' },
    ],
    { catalogApiBase: 'http://catalog.test', fetchImpl },
  );
  check('catalog + legacy rows price from per-compound catalog prices', priced.totalCents === 6600 + 2000, `(got ${priced.totalCents})`);
  check('Stripe line items carry catalog unit amounts in USD', priced.lineItems[0].price_data.unit_amount === 6600 && priced.lineItems[1].price_data.unit_amount === 2000);
  check('line item names use the catalog id + pack', priced.lineItems[0].price_data.product_data.name === 'BAS 00293357 · 5 mg');
}

{
  const { state, fetchImpl } = fetchCounter();
  await priceMoleculeCartFromCatalog(
    [
      { catalogId: 'BAS 00293357', amount: 1, totalPrice: 22 },
      { catalogId: 'BAS 00293357', amount: 5, totalPrice: 66 },
    ],
    { catalogApiBase: 'http://catalog.test', fetchImpl },
  );
  check('duplicate codes share one upstream lookup', state.calls.length === 1, `(got ${state.calls.length})`);
}

{
  const { fetchImpl } = fetchCounter();
  await expectError(
    'unknown catalog code → 400-style catalog error',
    priceMoleculeCartFromCatalog([{ catalogId: 'BAS 99999999', amount: 5, totalPrice: 66 }], { catalogApiBase: 'http://catalog.test', fetchImpl }),
    Error,
    (err) => /catalog/i.test(err.message) && !(err instanceof CatalogPricingUpstreamError),
  );
}

{
  const { fetchImpl } = fetchCounter();
  await expectError(
    '2 mg pack without a catalog price → explicit error (no invented price)',
    priceMoleculeCartFromCatalog([{ catalogId: 'BAS 00293357', amount: 2, totalPrice: 44 }], { catalogApiBase: 'http://catalog.test', fetchImpl }),
    Error,
    (err) => /2 mg price/.test(err.message),
  );
}

{
  const { fetchImpl } = fetchCounter();
  await expectError(
    'quantity other than numeric 1 still rejected',
    priceMoleculeCartFromCatalog([{ catalogId: 'BAS 00293357', amount: 1, quantity: 2, totalPrice: 22 }], { catalogApiBase: 'http://catalog.test', fetchImpl }),
    Error,
    (err) => /quantity/.test(err.message),
  );
  await expectError(
    'quantity "1" as string still rejected',
    priceMoleculeCartFromCatalog([{ catalogId: 'BAS 00293357', amount: 1, quantity: '1', totalPrice: 22 }], { catalogApiBase: 'http://catalog.test', fetchImpl }),
    Error,
  );
  await expectError(
    'unsupported pack size still rejected',
    priceMoleculeCartFromCatalog([{ catalogId: 'BAS 00293357', amount: 3, totalPrice: 22 }], { catalogApiBase: 'http://catalog.test', fetchImpl }),
    Error,
    (err) => /package size/.test(err.message),
  );
}

console.log(`\ncatalog-pricing: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
