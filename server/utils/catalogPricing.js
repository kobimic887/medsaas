// Internal-catalog checkout pricing from the original Asinex catalog API.
//
// Owner decision (2026-09-13): the original catalog API's per-compound prices
// supersede POST /api4/bas quotes everywhere money moves, and stock compounds
// are not purchasable at all. The verified lookup is
//
//   GET {catalogApiBase}/api/id/{code}
//
// where code is the catalog row's id_number (e.g. "BAS 00293357" — prefix and
// inner space intact, URL-encoded). Measured live 2026-09-13: the row carries
// per-compound price_1mg / price_5mg / price_10mg (no price_2mg) consistent
// with the /api/all browse rows, and an unknown code answers HTTP 200 with an
// EMPTY body — treat that as unresolved, never as a price of zero.
//
// /api4/bas must not be called at all — pricing or search. BAS-code SEARCH
// (Simulation searchType 'bas', the POST /api/api4/bas route in
// server/index.js and the staging demo mirror) is preserved through the same
// verified wrapper via searchCatalogRowsByBasCodes below.

import {
  catalogRowsFromResponse,
  normalizeMoleculeCartRequest,
  priceMoleculeCart,
} from './asinexCompound.js';

// Distinct codes priced in one checkout. The cart itself is capped at 100
// rows; the headroom only absorbs whitespace variants of the same code.
export const MAX_CATALOG_PRICING_CODES = 200;

export class CatalogPricingValidationError extends Error {
  constructor(message) {
    super(message);
    this.name = 'CatalogPricingValidationError';
  }
}

export class CatalogPricingUpstreamError extends Error {
  constructor(message, { status } = {}) {
    super(message);
    this.name = 'CatalogPricingUpstreamError';
    this.status = status;
  }
}

/**
 * Basket rows from the stock-offers era cannot be repriced or converted:
 * checkout is refused until the client removes them (the navbar does this
 * automatically on MOLECULE_STOCK_ITEMS_UNSUPPORTED).
 */
export class MoleculeCartStockItemsError extends Error {
  constructor(unsupportedItems) {
    super('Stock compounds are no longer purchasable. Remove them from your basket to continue.');
    this.name = 'MoleculeCartStockItemsError';
    this.unsupportedItems = unsupportedItems;
  }
}

/** Normalize one catalog code string; empty/invalid → ''. */
export function normalizeCatalogCode(value) {
  if (value === undefined || value === null) return '';
  const text = String(value).trim().replace(/\s+/g, ' ');
  if (!text || text === 'N/A' || text.length > 64) return '';
  return text;
}

/**
 * Stock-origin basket row detection. Every stock add since the feature
 * existed carried `source: 'stock'` (client/src/utils/stockOffers.js), but
 * legacy catalog rows (controlpanel, pre-offers Simulation) carry NO source
 * field at all — absence of `source` means catalog, never stock. The
 * `stockCode` marker only ever came from stock offers, so it is treated as
 * stock-origin even on a hypothetical source-less row: stock items must fail
 * loudly, not silently convert into catalog purchases.
 */
export function isStockOriginCartItem(item) {
  if (!item || typeof item !== 'object') return false;
  if (item.source === 'stock') return true;
  if (item.source === undefined || item.source === null || item.source === '') {
    return normalizeCatalogCode(item.stockCode) !== '';
  }
  return false;
}

/**
 * Normalize one upstream /api/id row into the shape priceMoleculeCart reads:
 * the identifiers it indexes (id_number) plus lowercase price_*mg fields.
 */
export function catalogCompoundFromIdRow(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const code = normalizeCatalogCode(
    raw.id_number ?? raw.ID_NUMBER ?? raw.idNumber
      ?? raw.bas_code ?? raw.BAS_CODE ?? raw.ASINEX_ID,
  );
  if (!code) return null;
  const price = (amountMg) => {
    for (const key of [`price_${amountMg}mg`, `PRICE_${amountMg}MG`]) {
      if (raw[key] !== undefined && raw[key] !== null && raw[key] !== '') {
        const n = Number(raw[key]);
        if (Number.isFinite(n) && n > 0) return n;
      }
    }
    return undefined;
  };
  const smiles = typeof (raw.smiles_string ?? raw.SMILES_STRING) === 'string'
    ? String(raw.smiles_string ?? raw.SMILES_STRING).trim()
    : '';
  const formula = typeof (raw.brutto_formula ?? raw.BRUTTO_FORMULA) === 'string'
    ? String(raw.brutto_formula ?? raw.BRUTTO_FORMULA).trim()
    : '';
  return {
    id: raw.id ?? null,
    id_number: code,
    ASINEX_ID: code,
    smiles_string: smiles || undefined,
    brutto_formula: formula || undefined,
    // Measured upstream packs are 1/5/10 mg; price_2mg is carried only when
    // the catalog row actually has one (a 2 mg cart row without it fails
    // priceMoleculeCart with "no valid 2 mg price" instead of inventing one).
    price_1mg: price(1),
    price_2mg: price(2),
    price_5mg: price(5),
    price_10mg: price(10),
  };
}

/** One RAW upstream /api/id row (all catalog fields), or null when unlisted. */
async function fetchRawCatalogIdRow(code, { base, fetchFn }) {
  const upstreamUrl = `${base}/api/id/${encodeURIComponent(code)}`;
  let response;
  try {
    response = await fetchFn(upstreamUrl, {
      method: 'GET',
      headers: { Accept: 'application/json' },
    });
  } catch (err) {
    throw new CatalogPricingUpstreamError(err?.message || 'Catalog lookup failed');
  }
  const text = await response.text();
  if (response.status === 404) return null;
  if (!response.ok) {
    throw new CatalogPricingUpstreamError(`Catalog lookup status ${response.status}`, {
      status: response.status,
    });
  }
  if (!text.trim()) return null; // measured: unknown code → 200 + empty body
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new CatalogPricingUpstreamError('Catalog lookup returned non-JSON', {
      status: response.status,
    });
  }
  const rows = catalogRowsFromResponse(data);
  return rows.length > 0 ? rows[0] : null;
}

async function fetchCatalogIdRow(code, { base, fetchFn }) {
  const raw = await fetchRawCatalogIdRow(code, { base, fetchFn });
  return raw ? catalogCompoundFromIdRow(raw) : null;
}

/**
 * Look up original-catalog rows by compound code (id_number).
 * Unresolved codes come back as `unresolvedCodes`; upstream failures throw
 * CatalogPricingUpstreamError so checkout aborts instead of pricing stale data.
 * @param {string[]} codes — already normalized
 * @param {{ catalogApiBase: string, fetchImpl?: Function, concurrency?: number }} opts
 */
export async function resolveCatalogCompoundsByCode(codes, opts = {}) {
  const { catalogApiBase, fetchImpl, concurrency = 6 } = opts;
  if (!Array.isArray(codes) || codes.length === 0) {
    throw new CatalogPricingValidationError('At least one catalog code is required');
  }
  if (codes.length > MAX_CATALOG_PRICING_CODES) {
    throw new CatalogPricingValidationError(`At most ${MAX_CATALOG_PRICING_CODES} catalog codes per request`);
  }
  const base = typeof catalogApiBase === 'string' ? catalogApiBase.replace(/\/$/, '') : '';
  if (!base) {
    throw new CatalogPricingUpstreamError('Catalog API base is not configured');
  }
  const fetchFn = fetchImpl || fetch;

  const rowsByCode = new Map();
  let cursor = 0;
  async function worker() {
    while (cursor < codes.length) {
      const code = codes[cursor];
      cursor += 1;
      if (rowsByCode.has(code)) continue;
      const row = await fetchCatalogIdRow(code, { base, fetchFn });
      rowsByCode.set(code, row); // null = unresolved (upstream 200 + empty body)
    }
  }
  await Promise.all(
    Array.from({ length: Math.max(1, Math.min(concurrency, codes.length)) }, worker),
  );

  const compounds = [];
  const unresolvedCodes = [];
  for (const code of codes) {
    const row = rowsByCode.get(code);
    if (row) compounds.push(row);
    else unresolvedCodes.push(code);
  }
  return { compounds, unresolvedCodes };
}

/**
 * Re-price a molecule cart from the original catalog API. Client prices and
 * names are discarded; stock-origin rows are refused before any network call.
 * Throws MoleculeCartStockItemsError / CatalogPricing*Error / plain Errors
 * from priceMoleculeCart (unknown code, missing pack price, bad quantity…).
 */
export async function priceMoleculeCartFromCatalog(cartItems, opts = {}) {
  const requested = normalizeMoleculeCartRequest(cartItems);

  const unsupportedItems = [];
  cartItems.forEach((item, index) => {
    if (isStockOriginCartItem(item)) {
      unsupportedItems.push({
        index,
        catalogId: requested[index].catalogId,
        name: String(item?.name || requested[index].catalogId || '').slice(0, 120),
      });
    }
  });
  if (unsupportedItems.length > 0) throw new MoleculeCartStockItemsError(unsupportedItems);

  const codes = [...new Set(requested.map((item) => item.catalogId))];
  const { compounds } = await resolveCatalogCompoundsByCode(codes, opts);
  return priceMoleculeCart(cartItems, compounds);
}

// ── BAS-code search on the verified wrapper ──────────────────────────────────

// Upstream /api4/bas used to accept a bounded comma-separated code list.
export const MAX_BAS_SEARCH_CODES = 50;

/**
 * Parse a BAS search body's code list: { bas: "A,B" } or { bas: ["A","B"] }.
 * Empty/N/A entries are skipped, whitespace collapses, dedupes, caps at
 * MAX_BAS_SEARCH_CODES. Never throws — an unusable body is simply no codes.
 */
export function parseBasSearchCodes(raw) {
  const list = typeof raw === 'string'
    ? raw.split(',')
    : Array.isArray(raw)
      ? raw
      : [];
  const seen = new Set();
  const codes = [];
  for (const entry of list) {
    const code = normalizeCatalogCode(entry);
    if (!code || seen.has(code)) continue;
    seen.add(code);
    codes.push(code);
    if (codes.length >= MAX_BAS_SEARCH_CODES) break;
  }
  return codes;
}

/**
 * BAS-code search preserved through the verified read-only catalog wrapper:
 * each requested code is one GET {catalogApiBase}/api/id/<code> lookup (the
 * same endpoint browse, /api/asinex/id, and checkout pricing use). Returns
 * RAW catalog rows — every field the Simulation normalizer reads (id_number,
 * smiles, formula, mol_weight, available_mg, price_*mg) — id-ordered, rows
 * with id ≤ fromId dropped, capped at pageSize. Codes the catalog does not
 * list are skipped, so an unknown code answers [] rather than an error.
 */
export async function searchCatalogRowsByBasCodes(codes, {
  catalogApiBase,
  fetchImpl,
  fromId = 0,
  pageSize = MAX_BAS_SEARCH_CODES,
  concurrency = 5,
} = {}) {
  if (!Array.isArray(codes) || codes.length === 0) return [];
  const base = typeof catalogApiBase === 'string' ? catalogApiBase.replace(/\/$/, '') : '';
  if (!base) throw new CatalogPricingUpstreamError('Catalog API base is not configured');
  const fetchFn = fetchImpl || fetch;

  const rows = [];
  let cursor = 0;
  const workers = Array.from(
    { length: Math.max(1, Math.min(concurrency, codes.length)) },
    async () => {
      while (cursor < codes.length) {
        const code = codes[cursor];
        cursor += 1;
        const row = await fetchRawCatalogIdRow(code, { base, fetchFn });
        if (row) rows.push(row);
      }
    },
  );
  await Promise.all(workers);

  const fromIdNumber = Number(fromId);
  const floor = Number.isFinite(fromIdNumber) && fromIdNumber > 0 ? fromIdNumber : 0;
  const pageSizeNumber = Number.isFinite(Number(pageSize))
    ? Math.min(Math.max(Math.trunc(Number(pageSize)), 1), MAX_BAS_SEARCH_CODES)
    : MAX_BAS_SEARCH_CODES;
  return rows
    .filter((row) => !floor || (Number.isSafeInteger(Number(row.id)) && Number(row.id) > floor))
    .sort((a, b) => (Number(a.id) || 0) - (Number(b.id) || 0))
    .slice(0, pageSizeNumber);
}
