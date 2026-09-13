// Client helpers for Internal-catalog basket items.
//
// Owner decision 2026-09-13 supersedes the earlier live-quote pricing: the
// Internal catalog displays and baskets the ORIGINAL catalog API's
// per-compound pack prices carried on its own browse/search responses
// (browse rows: price_1mg/5mg/10mg; /api4 search rows add price_2mg — the
// page normalizer maps both spellings onto PRICE_*MG). The browser never
// calls POST /api/stock-offers or /api4/bas for pricing, and stock-source
// rows carry no prices at all (server /api/stock-offers answers
// 503 STOCK_OFFERS_DISABLED and checkout refuses stock-origin basket rows
// with MOLECULE_STOCK_ITEMS_UNSUPPORTED).
// Checkout remains server-owned: it validates the basket against the
// catalog's current prices and answers 409 MOLECULE_PRICES_CHANGED when
// they moved.

export const CATALOG_PACK_WEIGHTS_MG = Object.freeze([1, 2, 5, 10]);

/**
 * The supplier code an Internal-catalog row is identified and checked out by.
 * BAS-first chain, matching the server cart normalizer so the displayed code
 * is the code checkout verifies. Identity only — never a price source.
 */
export function catalogOfferCode(molecule) {
  const raw = molecule
    && (molecule.BAS_CODE || molecule.bas_code || molecule.basCode
      || molecule.ASINEX_ID || molecule.id_number || molecule.id);
  if (raw === undefined || raw === null) return '';
  const text = String(raw).trim();
  if (!text || text === 'N/A') return '';
  return text;
}

/**
 * Build a cart entry from a catalog row's displayed pack price. One pack per
 * basket row (no quantity field); a missing or non-positive price can never
 * be added, so stock rows and price-less catalog rows stay out of the basket.
 */
export function cartItemFromCatalogPrice(molecule, amountMg, priceUSD) {
  const code = catalogOfferCode(molecule);
  if (!code) return null;
  const amount = Number(amountMg);
  const price = Number(priceUSD);
  if (!Number.isInteger(amount) || !CATALOG_PACK_WEIGHTS_MG.includes(amount)) return null;
  if (!Number.isFinite(price) || price <= 0) return null;

  return {
    name: molecule?.BRUTTO_FORMULA || molecule?.formula || molecule?.SMILES_STRING || molecule?.smiles || code,
    amount,
    price,
    pricePerMg: price,
    totalPrice: price,
    id: code,
    catalogId: code,
    currency: 'usd',
    source: 'catalog',
    smiles: molecule?.SMILES_STRING || molecule?.smiles || '',
    formula: molecule?.BRUTTO_FORMULA || molecule?.formula || '',
  };
}
