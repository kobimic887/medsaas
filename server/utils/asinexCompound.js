// Server-side ASINEX stock helpers, reverse-engineered from the legacy eShop
// storefront (eitangenis/eShop @ ad7d332). See
// docs/ASINEX-ESHOP-REVERSE-ENGINEERING.md.
//
// Two jobs:
//  - Authoritative pricing. The legacy storefront computed prices in the
//    browser (Asinex.eShop.JS/Price.js `CalcPrice`), so a client could submit
//    any price/total. `price_category` (1-3) is a stored compound column; the
//    price depends on (category, weight-in-mg). This table is the server-side
//    source of truth — never trust a browser-supplied price.
//  - Normalising the legacy response casing (elE_ID, baS_CODE, molwt, ...) at
//    the boundary so callers never deal with old ASP.NET serializer quirks.

// price_category -> weight(mg) -> USD.
export const ASINEX_PRICE_TABLE = Object.freeze({
  1: Object.freeze({ 1: 100, 2: 120, 5: 140, 10: 160 }),
  2: Object.freeze({ 1: 160, 2: 185, 5: 210, 10: 235 }),
  3: Object.freeze({ 1: 200, 2: 240, 5: 280, 10: 320 })
});

// Flat per-order shipping surcharge the legacy storefront added at submit time.
export const ASINEX_SHIPPING_USD = 50;

// The only weights the legacy storefront sells.
export const ASINEX_WEIGHTS_MG = Object.freeze([1, 2, 5, 10]);

// Price for one (category, weight); null if the pair isn't in the table.
export function priceForCategory(category, weightMg) {
  const tier = ASINEX_PRICE_TABLE[Number(category)];
  if (!tier) return null;
  const price = tier[Number(weightMg)];
  return typeof price === 'number' ? price : null;
}

// All weight prices for a category as { 1, 2, 5, 10 }; null for unknown category.
export function priceTableForCategory(category) {
  const tier = ASINEX_PRICE_TABLE[Number(category)];
  return tier ? { ...tier } : null;
}

// Map one legacy eShop compound to clean camelCase and attach server-computed
// prices. Tolerant of both the legacy casing (elE_ID) and already-clean input.
export function normalizeShopCompound(raw) {
  if (!raw || typeof raw !== 'object') return raw;
  const pick = (...keys) => {
    for (const key of keys) {
      if (raw[key] !== undefined && raw[key] !== null) return raw[key];
    }
    return null;
  };
  const priceCategory = pick('price_category', 'priceCategory');
  return {
    eleId: pick('elE_ID', 'ELE_ID', 'eleId'),
    basCode: pick('baS_CODE', 'BAS_CODE', 'basCode'),
    molWeight: pick('molwt', 'mol_weight', 'molWeight'),
    molFormula: pick('molformula', 'brutto_formula', 'molFormula'),
    availableMg: pick('available', 'available_mg', 'availableMg'),
    clogp: pick('clogp'),
    hac: pick('hac', 'h_acc_count'),
    salt: raw.salt ?? '',
    priceCategory,
    prices: priceTableForCategory(priceCategory)
  };
}

// Normalise a legacy POST /api/Shop search response ({ list, found, totalFound }).
// Anything that isn't that shape is returned unchanged (defensive passthrough).
export function normalizeShopSearchResponse(data) {
  if (!data || !Array.isArray(data.list)) return data;
  return {
    ...data,
    list: data.list.map(normalizeShopCompound),
    found: typeof data.found === 'number' ? data.found : data.list.length,
    totalFound:
      typeof data.totalFound === 'number'
        ? data.totalFound
        : typeof data.found === 'number'
          ? data.found
          : data.list.length
  };
}
