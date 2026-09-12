// Live stock-compound pack offers via ASINEX /api4/bas.
//
// Stock search returns structure + dated snapshot quantities only. Purchasable
// packs come from a separate read of the supplier catalog keyed by MAIN_BAS /
// bas_code (strings, leading zeros intact). Client totals are never trusted —
// checkout re-resolves the same codes and prices through priceMoleculeCart.
//
// Upstream measured 2026-09-12: POST {ASINEX_API_BASE}/api4/bas with
// { fromId, pageSize, bas: "CODE1,CODE2,..." } returns per-code price_1|2|5|10mg.
// Deployed eShop /api/Shop returns empty for the same in-stock codes — do not
// fall back to it. See docs/DATA-STOCK-COMPOUNDS.md and docs/ASINEX-ESHOP-HANDOFF.md.

import {
  ASINEX_WEIGHTS_MG,
  catalogRowsFromResponse,
  normalizeMoleculeCartRequest,
  priceMoleculeCart,
} from './asinexCompound.js';

export const STOCK_OFFER_WEIGHTS_MG = ASINEX_WEIGHTS_MG;
export const MAX_STOCK_OFFER_CODES = 50;

export class StockOffersValidationError extends Error {
  constructor(message) {
    super(message);
    this.name = 'StockOffersValidationError';
  }
}

export class StockOffersUpstreamError extends Error {
  constructor(message, { status } = {}) {
    super(message);
    this.name = 'StockOffersUpstreamError';
    this.status = status;
  }
}

/** Normalize one stock code string; empty/invalid → ''. */
export function normalizeStockOfferCode(value) {
  if (value === undefined || value === null) return '';
  const text = String(value).trim().replace(/\s+/g, ' ');
  if (!text || text === 'N/A' || text.length > 64) return '';
  return text;
}

/**
 * Parse { codes: string[] } or { bas: "a,b,c" } from the request body.
 * Dedupes case-sensitively after whitespace normalize; preserves first-seen order.
 */
export function parseStockOfferCodes(body) {
  if (!body || typeof body !== 'object') {
    throw new StockOffersValidationError('Request body must be a JSON object with codes');
  }

  let rawList;
  if (Array.isArray(body.codes)) {
    rawList = body.codes;
  } else if (typeof body.bas === 'string') {
    rawList = body.bas.split(',');
  } else {
    throw new StockOffersValidationError('Provide codes: string[] (or bas: comma-separated string)');
  }

  if (rawList.length === 0) {
    throw new StockOffersValidationError('At least one stock code is required');
  }
  if (rawList.length > MAX_STOCK_OFFER_CODES) {
    throw new StockOffersValidationError(`At most ${MAX_STOCK_OFFER_CODES} stock codes per request`);
  }

  const seen = new Set();
  const codes = [];
  for (const entry of rawList) {
    const code = normalizeStockOfferCode(entry);
    if (!code) {
      throw new StockOffersValidationError('Each stock code must be a non-empty string');
    }
    if (seen.has(code)) continue;
    seen.add(code);
    codes.push(code);
  }
  if (codes.length === 0) {
    throw new StockOffersValidationError('At least one stock code is required');
  }
  return codes;
}

function priceField(raw, amountMg) {
  const keys = [`price_${amountMg}mg`, `PRICE_${amountMg}MG`];
  for (const key of keys) {
    if (raw[key] !== undefined && raw[key] !== null && raw[key] !== '') {
      const n = Number(raw[key]);
      if (Number.isFinite(n) && n > 0) return n;
    }
  }
  return null;
}

/** Packs with positive USD prices only (1/2/5/10 mg). */
export function packsFromOfferRow(raw) {
  if (!raw || typeof raw !== 'object') return [];
  const packs = [];
  for (const amountMg of STOCK_OFFER_WEIGHTS_MG) {
    const priceUSD = priceField(raw, amountMg);
    if (priceUSD !== null) packs.push({ amountMg, priceUSD });
  }
  return packs;
}

/**
 * Normalize one upstream /api4/bas row into a stock offer.
 * Returns null when bas_code is missing.
 */
export function normalizeStockOffer(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const code = normalizeStockOfferCode(
    raw.bas_code ?? raw.BAS_CODE ?? raw.basCode ?? raw.baS_CODE ?? raw.ASINEX_ID,
  );
  if (!code) return null;

  const offerId = raw.id ?? raw.elE_ID ?? raw.ELE_ID ?? raw.eleId ?? null;
  const smiles = typeof (raw.smiles_string ?? raw.SMILES_STRING ?? raw.smiles) === 'string'
    ? String(raw.smiles_string ?? raw.SMILES_STRING ?? raw.smiles).trim()
    : '';
  const formula = typeof (raw.brutto_formula ?? raw.BRUTTO_FORMULA ?? raw.molFormula) === 'string'
    ? String(raw.brutto_formula ?? raw.BRUTTO_FORMULA ?? raw.molFormula).trim()
    : '';
  const packs = packsFromOfferRow(raw);

  return {
    offerId,
    code,
    packs,
    smiles: smiles || undefined,
    formula: formula || undefined,
    molWeight: raw.mol_weight ?? raw.molWeight ?? raw.molwt ?? undefined,
    // Snapshot availability from the catalog row when present (not the MOE export).
    totNettoMg: raw.tot_netto ?? raw.available ?? raw.availableMg ?? undefined,
    // Raw lowercase price fields kept for priceMoleculeCart / checkout.
    price_1mg: priceField(raw, 1) ?? undefined,
    price_2mg: priceField(raw, 2) ?? undefined,
    price_5mg: priceField(raw, 5) ?? undefined,
    price_10mg: priceField(raw, 10) ?? undefined,
  };
}

/** Shape expected by priceMoleculeCart (bas_code + price_*mg). */
export function compoundRowFromOffer(offer) {
  if (!offer || typeof offer !== 'object') return null;
  const code = normalizeStockOfferCode(offer.code);
  if (!code) return null;
  return {
    id: offer.offerId,
    bas_code: code,
    ASINEX_ID: code,
    BAS_CODE: code,
    smiles_string: offer.smiles,
    brutto_formula: offer.formula,
    price_1mg: offer.price_1mg,
    price_2mg: offer.price_2mg,
    price_5mg: offer.price_5mg,
    price_10mg: offer.price_10mg,
  };
}

/**
 * Look up live pack offers for stock codes.
 * @param {string[]} codes — already parsed/normalized
 * @param {{ catalogApiBase: string, fetchImpl?: Function }} opts
 */
export async function resolveStockOffers(codes, { catalogApiBase, fetchImpl } = {}) {
  if (!Array.isArray(codes) || codes.length === 0) {
    throw new StockOffersValidationError('At least one stock code is required');
  }
  const base = typeof catalogApiBase === 'string' ? catalogApiBase.replace(/\/$/, '') : '';
  if (!base) {
    throw new StockOffersUpstreamError('Catalog API base is not configured');
  }
  const fetchFn = fetchImpl || fetch;
  const upstreamUrl = `${base}/api4/bas`;
  const body = {
    fromId: 0,
    pageSize: Math.max(codes.length, 1),
    bas: codes.join(','),
  };

  let response;
  try {
    response = await fetchFn(upstreamUrl, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });
  } catch (err) {
    throw new StockOffersUpstreamError(err?.message || 'Offer lookup failed');
  }

  const text = await response.text();
  let data;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    throw new StockOffersUpstreamError('Offer lookup returned non-JSON', { status: response.status });
  }

  if (!response.ok) {
    throw new StockOffersUpstreamError(
      typeof data === 'object' && data?.error ? String(data.error) : `Upstream status ${response.status}`,
      { status: response.status },
    );
  }

  const rows = catalogRowsFromResponse(data);
  const offersByCode = new Map();
  for (const row of rows) {
    const offer = normalizeStockOffer(row);
    if (!offer) continue;
    // First match wins; upstream should not duplicate bas_code.
    if (!offersByCode.has(offer.code)) offersByCode.set(offer.code, offer);
  }

  const offers = [];
  const unresolvedCodes = [];
  for (const code of codes) {
    const offer = offersByCode.get(code);
    if (offer) offers.push(offer);
    else unresolvedCodes.push(code);
  }

  return { offers, unresolvedCodes, offersByCode };
}

/**
 * Re-price a molecule cart from live offers. Client prices are discarded.
 * Throws StockOffersValidationError / StockOffersUpstreamError / Error from priceMoleculeCart.
 */
export async function priceMoleculeCartFromOffers(cartItems, resolveOpts) {
  const requested = normalizeMoleculeCartRequest(cartItems);
  const codes = [...new Set(requested.map((item) => item.catalogId))];
  const { offers } = await resolveStockOffers(codes, resolveOpts);
  const compounds = offers.map(compoundRowFromOffer).filter(Boolean);
  return priceMoleculeCart(cartItems, compounds);
}
